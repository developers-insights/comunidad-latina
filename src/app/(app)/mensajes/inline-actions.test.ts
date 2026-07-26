import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del mensaje INLINE desde una publicación.
 *
 * Bordes mockeados con el patrón del repo (lib/tenant/guard.test.ts):
 * `vi.hoisted` + `vi.mock` + stub thenable del query builder. No se toca ni
 * Supabase ni el RPC real.
 *
 * Garantías cubiertas:
 *  - Feliz: request_contact + insert del mensaje con el sender del JWT, y
 *    revalidación de /mensajes.
 *  - Body vacío → `invalid` SIN llamar al guard ni al RPC (zod puro primero).
 *  - El aviso es propio → código `self` con copy amable (no un error rojo).
 *  - Bloqueo → `blocked` con el MISMO texto en ambas direcciones.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  unstable_cache: (fn: unknown) => fn,
}));
// El aviso al dueño (notificación + email) es best-effort y ajeno a estas
// garantías: se inertiza entero para que el test no dependa de admin client,
// Resend ni del resolve del tenant (que usa next/headers).
vi.mock("@/lib/tenant/resolve", () => ({ getTenant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("sin admin en tests");
  }),
}));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmailInBackground: vi.fn() }));
vi.mock("@/lib/email/recipients", () => ({ getRecipientEmail: vi.fn() }));
vi.mock("@/lib/email/templates", () => ({ leadReceivedEmail: vi.fn() }));

import { sendListingMessageAction } from "./inline-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";
const CONVERSATION_ID = "55555555-5555-4555-8555-555555555555";

type OpResult = { data?: unknown; error?: unknown };

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createSupabaseStub(config: {
  rpc?: OpResult;
  insert?: OpResult;
} = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        return builder;
      }),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(config.insert ?? { error: null }).then(resolve, reject),
    };
    return builder;
  });

  const rpc = vi.fn(async (name: string, args: unknown) => {
    calls.push({ table: `rpc:${name}`, method: "rpc", args: [args] });
    return config.rpc ?? { data: CONVERSATION_ID, error: null };
  });

  return { client: { from, rpc }, from, rpc, calls };
}

function useGuardOk(config: Parameters<typeof createSupabaseStub>[0] = {}) {
  const stub = createSupabaseStub(config);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* -------------------------- sendListingMessageAction ----------------------- */

describe("sendListingMessageAction", () => {
  it("abre la conversación y adjunta el mensaje de presentación", async () => {
    const stub = useGuardOk();

    const result = await sendListingMessageAction({
      listingId: LISTING_ID,
      body: "  Hola, ¿sigue disponible?  ",
    });

    expect(result).toEqual({ ok: true, conversationId: CONVERSATION_ID });
    expect(stub.rpc).toHaveBeenCalledWith("request_contact", {
      p_listing_id: LISTING_ID,
    });
    const inserted = stub.calls.find((call) => call.method === "insert");
    expect(inserted?.table).toBe("messages");
    // El body llega trimeado y el sender sale del JWT, nunca del cliente.
    expect(inserted?.args[0]).toEqual({
      tenant_id: TENANT_ID,
      conversation_id: CONVERSATION_ID,
      sender_id: USER_ID,
      body: "Hola, ¿sigue disponible?",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/mensajes");
  });

  it("rechaza un mensaje vacío antes de tocar el guard y el RPC", async () => {
    const result = await sendListingMessageAction({
      listingId: LISTING_ID,
      body: "   ",
    });

    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("rechaza un listingId que no es uuid", async () => {
    const result = await sendListingMessageAction({
      listingId: "no-es-uuid",
      body: "Hola",
    });

    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("mapea CANNOT_CONTACT_SELF a 'self' y no inserta ningún mensaje", async () => {
    const stub = useGuardOk({
      rpc: { data: null, error: { code: "P0001", message: "CANNOT_CONTACT_SELF: es tu propio aviso." } },
    });

    const result = await sendListingMessageAction({
      listingId: LISTING_ID,
      body: "Hola",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("self");
    expect(result.message).toBeTruthy();
    expect(stub.from).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("mapea USER_BLOCKED a 'blocked' sin revelar quién bloqueó a quién", async () => {
    useGuardOk({
      rpc: {
        data: null,
        error: { code: "P0001", message: "USER_BLOCKED: el contacto con esta persona no está disponible." },
      },
    });

    const result = await sendListingMessageAction({
      listingId: LISTING_ID,
      body: "Hola",
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("blocked");
    expect(result.message).toBe("El contacto con esta persona no está disponible.");
  });

  it("sin sesión no llega al RPC", async () => {
    const stub = createSupabaseStub();
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "copy del guard",
      tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
      supabase: stub.client,
      user: null,
    });

    const result = await sendListingMessageAction({
      listingId: LISTING_ID,
      body: "Hola",
    });

    if (result.ok) throw new Error("esperaba fallo");
    expect(result.code).toBe("unauthenticated");
    expect(stub.rpc).not.toHaveBeenCalled();
  });
});
