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
  limit: vi.fn(() => ({ ok: true })),
  moderateText: vi.fn(async () => ({
    flagged: false,
    categories: [] as string[],
    score: 0,
    skipped: true,
  })),
  createNotification: vi.fn(async () => ({ ok: true, deduped: false })),
  adminThrows: { value: true },
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
vi.mock("@/lib/moderation", () => ({ moderateText: mocks.moderateText }));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  unstable_cache: (fn: unknown) => fn,
}));
// El aviso al dueño (notificación + email) es best-effort y ajeno a estas
// garantías: se inertiza entero para que el test no dependa de admin client,
// Resend ni del resolve del tenant (que usa next/headers).
vi.mock("@/lib/tenant/resolve", () => ({ getTenant: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  // Por default sigue lanzando (los tests viejos se apoyan en que el bloque de
  // aviso se corte ahí). Los tests del aviso lo apagan para poder mirar QUÉ
  // notificación se emite.
  createAdminClient: vi.fn(() => {
    if (mocks.adminThrows.value) throw new Error("sin admin en tests");
    return {} as never;
  }),
}));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: mocks.createNotification }));
vi.mock("@/lib/email", () => ({ sendEmailInBackground: vi.fn() }));
vi.mock("@/lib/email/recipients", () => ({ getRecipientEmail: vi.fn() }));
vi.mock("@/lib/email/templates", () => ({ leadReceivedEmail: vi.fn() }));

import { sendListingMessageAction } from "./inline-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";
const CONVERSATION_ID = "55555555-5555-4555-8555-555555555555";
const OWNER_ID = "77777777-7777-4777-8777-777777777777";

type OpResult = { data?: unknown; error?: unknown };

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createSupabaseStub(config: {
  rpc?: OpResult;
  insert?: OpResult;
  /**
   * Lo que contesta la lectura "¿ya había conversación por este aviso?" que
   * corre ANTES del RPC. Una función que lanza simula que esa lectura falla.
   */
  prior?: OpResult | (() => never);
  /** Lo que contesta la lectura del aviso, en el bloque de aviso al dueño. */
  lookup?: OpResult;
} = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        return builder;
      }),
      select: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "select", args });
        return builder;
      }),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        // El stub sirve a tres lecturas distintas y hay que distinguirlas por
        // tabla: la de "¿ya había conversación?" (conversations), la del aviso
        // (listings) y la del nombre de quien escribe (profiles).
        if (table === "listings") return config.lookup ?? { data: null, error: null };
        if (table === "profiles") {
          return { data: { display_name: "Ana" }, error: null };
        }
        if (typeof config.prior === "function") return config.prior();
        return config.prior ?? { data: null, error: null };
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
  mocks.limit.mockReturnValue({ ok: true });
  mocks.adminThrows.value = true;
  mocks.moderateText.mockResolvedValue({
    flagged: false,
    categories: [],
    score: 0,
    skipped: true,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/* -------------------------- sendListingMessageAction ----------------------- */

describe("sendListingMessageAction", () => {
  it("abre la conversación y adjunta el mensaje de presentación", async () => {
    const stub = useGuardOk();

    const result = await sendListingMessageAction({
      listingId: LISTING_ID,
      body: "  Hola, ¿sigue disponible?  ",
    });

    expect(result).toEqual({
      ok: true,
      conversationId: CONVERSATION_ID,
      // No había nada previo: la pantalla puede decir "mensaje enviado" sin
      // mentir sobre una conversación que no existía.
      reused: false,
    });
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

  /**
   * AUDITORÍA DE SEGURIDAD 2026-08-20 — esta action pasó a ser el canal de
   * contacto de Propiedades y Profesionales, donde antes se mandaba una
   * solicitud VACÍA. O sea: empezó a escribir texto libre de un usuario en
   * `messages`, la misma tabla que `sendMessageAction`, que ya documenta por
   * qué eso no puede ir sin techo ni moderación ("una cuenta sola es a la vez
   * una factura y un canal de hostigamiento con nuestro remitente").
   */
  it("con el techo agotado no crea nada: ni conversación ni mensaje", async () => {
    const stub = useGuardOk();
    mocks.limit.mockReturnValue({ ok: false });

    const result = await sendListingMessageAction({
      listingId: LISTING_ID,
      body: "Hola, ¿sigue disponible?",
    });

    expect(result).toEqual({ ok: false, code: "rate-limited" });
    // Lo que importa: se frenó ANTES del RPC. Un mensaje rechazado no puede
    // dejar atrás una conversación pendiente que la otra persona ve aparecer
    // vacía.
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("comparte el bucket con el chat: si fueran dos, el techo real sería el doble", async () => {
    useGuardOk();
    await sendListingMessageAction({ listingId: LISTING_ID, body: "Hola" });

    expect(mocks.limit).toHaveBeenCalledWith(`mensaje:${USER_ID}`, 120, 3_600_000);
  });

  it("un mensaje marcado por moderación no se entrega ni abre conversación", async () => {
    const stub = useGuardOk();
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      categories: ["harassment"],
      score: 0.9,
      skipped: false,
    });

    const result = await sendListingMessageAction({
      listingId: LISTING_ID,
      body: "texto que no va",
    });

    expect(result).toEqual({ ok: false, code: "flagged" });
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
  });

  /**
   * El segundo pedal del mismo hallazgo: cada llamada disparaba notificación y
   * mail al dueño, también cuando la conversación YA existía. Escribir diez
   * veces en un hilo abierto mandaba diez mails con nuestro remitente.
   */
  it("en un hilo que ya existía avisa como CHAT y deduplicado, no como contacto nuevo", async () => {
    mocks.adminThrows.value = false;
    const stub = useGuardOk({
      prior: { data: { id: CONVERSATION_ID }, error: null },
      lookup: { data: { created_by: OWNER_ID, tenant_id: TENANT_ID, title: "Depto 2 amb" }, error: null },
    });

    const result = await sendListingMessageAction({
      listingId: LISTING_ID,
      body: "¿Sigue en pie?",
    });

    expect(result).toEqual({ ok: true, conversationId: CONVERSATION_ID, reused: true });
    expect(stub.calls.some((call) => call.table === "messages" && call.method === "insert")).toBe(true);

    // Avisa, sí: sin esto la otra persona no se entera nunca (la bandeja no
    // estrena badge porque el hilo ya estaba) mientras la pantalla de quien
    // escribió promete "te avisamos apenas te respondan".
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
    const [, payload] = mocks.createNotification.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    // Pero como MENSAJE deduplicado, no como "te contactaron por tu aviso":
    // ese aviso —y su mail de lead— ya salió la primera vez.
    expect(payload.kind).toBe("message");
    expect(payload.dedupeUnread).toBe(true);
    expect(payload.href).toBe(`/mensajes/${CONVERSATION_ID}`);
    // PRIVACIDAD: el cuerpo nunca lleva el texto del mensaje.
    expect(String(payload.body)).not.toContain("¿Sigue en pie?");
  });

  it("un contacto NUEVO sí avisa como solicitud de contacto", async () => {
    mocks.adminThrows.value = false;
    useGuardOk({
      lookup: { data: { created_by: OWNER_ID, tenant_id: TENANT_ID, title: "Depto 2 amb" }, error: null },
    });

    await sendListingMessageAction({ listingId: LISTING_ID, body: "Hola" });

    const [, payload] = mocks.createNotification.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(payload.kind).toBe("contact_request");
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
    // Lo que importa es que no se ESCRIBIÓ nada. (La lectura de "¿ya había
    // conversación?" sí corre antes del RPC, y por eso no se mide `from` a
    // secas: es un SELECT, no un efecto.)
    expect(stub.calls.filter((call) => call.method === "insert")).toHaveLength(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("si ya había conversación por el aviso, lo informa en vez de fingir un alta", async () => {
    const stub = useGuardOk({ prior: { data: { id: CONVERSATION_ID }, error: null } });

    const result = await sendListingMessageAction({
      listingId: LISTING_ID,
      body: "Otra consulta",
    });

    expect(result).toEqual({ ok: true, conversationId: CONVERSATION_ID, reused: true });
    // La lectura mira exactamente la fila que el índice único garantiza: este
    // aviso, este creador, este tenant.
    const read = stub.calls.find((call) => call.table === "conversations");
    expect(read?.method).toBe("select");
    // Y el mensaje se adjunta igual: la conversación se reusa, no se salta.
    expect(stub.calls.find((call) => call.method === "insert")?.table).toBe("messages");
  });

  it("si la lectura de reuso falla, no afirma nada: `reused` queda sin definir", async () => {
    useGuardOk({
      prior: () => {
        throw new Error("la lectura se cayó");
      },
    });

    const result = await sendListingMessageAction({
      listingId: LISTING_ID,
      body: "Hola",
    });

    expect(result).toEqual({ ok: true, conversationId: CONVERSATION_ID, reused: undefined });
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
