import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `saveTagPolicyAction` (Ajustes › Privacidad, columna `tag_policy`
 * de la 0089). Mismo aislamiento que `feed/tag-actions.test.ts`: se mockea
 * `requireTenantMatch` y se stubea el cliente de Supabase, nunca se toca la
 * base real.
 *
 * Garantías cubiertas:
 *  - zod primero: un valor que no es una de las tres opciones ni siquiera
 *    llega al guard.
 *  - `upsert` (no `update`) con `onConflict: "profile_id"`, tenant del guard
 *    y profile_id del JWT — nunca del cliente.
 *  - sin sesión / con divergencia de tenant no se escribe nada.
 *  - un error de la base (incluida la columna todavía sin existir) se
 *    reporta como fallo visible, nunca se traga en silencio.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { saveTagPolicyAction } from "./tag-policy-actions";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";

interface RecordedCall {
  method: string;
  args: unknown[];
}

function createSupabaseStub(result: { data?: unknown; error?: unknown } = { error: null }) {
  const calls: RecordedCall[] = [];
  const from = vi.fn((table: string) => {
    calls.push({ method: `from:${table}`, args: [table] });
    const upsert = vi.fn((...args: unknown[]) => {
      calls.push({ method: "upsert", args });
      return Promise.resolve(result);
    });
    return { upsert };
  });
  return { client: { from }, from, calls };
}

function useGuardOk(result?: { data?: unknown; error?: unknown }) {
  const stub = createSupabaseStub(result);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

function useGuardFail(reason: "unauthenticated" | "tenant-mismatch") {
  const stub = createSupabaseStub();
  mocks.requireTenantMatch.mockResolvedValue({
    ok: false,
    reason,
    message: "copy del guard",
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
    supabase: stub.client,
    user: reason === "unauthenticated" ? null : { id: USER_ID },
  });
  return stub;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("saveTagPolicyAction", () => {
  it("un valor que no es una de las tres opciones no llega ni al guard", async () => {
    const result = await saveTagPolicyAction("cualquiera" as never);
    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("hace upsert con el tenant del guard y el profile_id del JWT, onConflict profile_id", async () => {
    const stub = useGuardOk();

    const result = await saveTagPolicyAction("following");

    expect(result).toEqual({ ok: true });
    expect(stub.from).toHaveBeenCalledWith("profiles_private");
    const upsertCall = stub.calls.find((call) => call.method === "upsert");
    expect(upsertCall?.args).toEqual([
      { profile_id: USER_ID, tenant_id: TENANT_ID, tag_policy: "following" },
      { onConflict: "profile_id" },
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/ajustes/privacidad");
  });

  it("sin sesión no escribe nada", async () => {
    const stub = useGuardFail("unauthenticated");
    const result = await saveTagPolicyAction("nobody");
    expect(result).toEqual({ ok: false, code: "unauthenticated" });
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("divergencia de tenant devuelve el copy del guard y no escribe", async () => {
    const stub = useGuardFail("tenant-mismatch");
    const result = await saveTagPolicyAction("everyone");
    expect(result).toEqual({
      ok: false,
      code: "tenant-mismatch",
      message: "copy del guard",
    });
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("un error de la base (columna sin existir, RLS, lo que sea) se reporta y no queda mudo", async () => {
    useGuardOk({ error: { code: "42703" } });
    const result = await saveTagPolicyAction("nobody");
    expect(result).toEqual({ ok: false, code: "error" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
