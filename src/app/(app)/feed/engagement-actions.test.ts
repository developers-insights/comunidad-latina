import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de las actions de ENGAGEMENT (guardar / vista de reel).
 *
 * Se aíslan los bordes con el patrón del repo (lib/tenant/guard.test.ts):
 * `vi.hoisted` + `vi.mock` + stub encadenable y "thenable" del query builder.
 * Nunca se toca Supabase real.
 *
 * Garantías cubiertas:
 *  - Guardar feliz → insert con dueño/tenant del guard, `saved: true`.
 *  - Sin sesión → `unauthenticated` y CERO escrituras (el guard corta antes).
 *  - Payload inválido → `invalid` SIN llamar al guard (zod puro primero).
 *  - 23505 (ya estaba guardado) → éxito idempotente, no error.
 *  - Quitar de guardados → delete acotado por sujeto + perfil propio.
 *  - Vista repetida en el día → 23505 tolerado, `ok: true`.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));

import { recordPostViewAction, toggleSaveAction } from "./engagement-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const POST_ID = "33333333-3333-4333-8333-333333333333";

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<Record<"insert" | "delete", OpResult>>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/** Query builder falso, encadenable y thenable (patrón route.test.ts de Stripe). */
function createSupabaseStub(config: Record<string, TableOps> = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const result = () => (op ? (tableConfig[op] ?? { error: null }) : { error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        op = "insert";
        return builder;
      }),
      delete: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "delete", args });
        op = "delete";
        return builder;
      }),
      eq: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        return builder;
      }),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  return { client: { from }, from, calls };
}

function useGuardOk(config: Record<string, TableOps> = {}) {
  const stub = createSupabaseStub(config);
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

function insertedRow(stub: ReturnType<typeof createSupabaseStub>, table: string) {
  return stub.calls.find((call) => call.table === table && call.method === "insert")
    ?.args[0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* ------------------------------ toggleSaveAction --------------------------- */

describe("toggleSaveAction", () => {
  it("guarda un post con el dueño y el tenant que resolvió el guard", async () => {
    const stub = useGuardOk();

    const result = await toggleSaveAction({
      subjectKind: "post",
      subjectId: POST_ID,
      save: true,
    });

    expect(result).toEqual({ ok: true, saved: true });
    expect(insertedRow(stub, "saves")).toEqual({
      tenant_id: TENANT_ID,
      subject_kind: "post",
      subject_id: POST_ID,
      profile_id: USER_ID,
    });
  });

  it("sin sesión devuelve 'unauthenticated' y no escribe nada", async () => {
    const stub = useGuardFail("unauthenticated");

    const result = await toggleSaveAction({
      subjectKind: "post",
      subjectId: POST_ID,
      save: true,
    });

    expect(result).toEqual({ ok: false, code: "unauthenticated" });
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("rechaza un id que no es uuid ANTES de tocar el guard", async () => {
    const result = await toggleSaveAction({
      subjectKind: "post",
      subjectId: "no-es-uuid",
      save: true,
    });

    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("trata el unique violation como éxito idempotente (doble tap)", async () => {
    useGuardOk({ saves: { insert: { error: { code: "23505" } } } });

    const result = await toggleSaveAction({
      subjectKind: "listing",
      subjectId: POST_ID,
      save: true,
    });

    expect(result).toEqual({ ok: true, saved: true });
  });

  it("un error real del insert sí es error", async () => {
    useGuardOk({ saves: { insert: { error: { code: "42501" } } } });

    const result = await toggleSaveAction({
      subjectKind: "post",
      subjectId: POST_ID,
      save: true,
    });

    expect(result).toEqual({ ok: false, code: "error" });
  });

  it("quitar de guardados borra solo la fila propia de ese sujeto", async () => {
    const stub = useGuardOk();

    const result = await toggleSaveAction({
      subjectKind: "post",
      subjectId: POST_ID,
      save: false,
    });

    expect(result).toEqual({ ok: true, saved: false });
    const filters = stub.calls
      .filter((call) => call.table === "saves" && call.method === "eq")
      .map((call) => call.args);
    expect(filters).toEqual([
      ["subject_kind", "post"],
      ["subject_id", POST_ID],
      ["profile_id", USER_ID],
    ]);
  });
});

/* --------------------------- recordPostViewAction -------------------------- */

describe("recordPostViewAction", () => {
  it("registra la vista con el viewer del JWT", async () => {
    const stub = useGuardOk();

    await expect(recordPostViewAction({ postId: POST_ID })).resolves.toEqual({ ok: true });
    expect(insertedRow(stub, "post_views")).toEqual({
      tenant_id: TENANT_ID,
      post_id: POST_ID,
      viewer_id: USER_ID,
    });
  });

  it("la segunda vista del día (23505) no es una falla", async () => {
    useGuardOk({ post_views: { insert: { error: { code: "23505" } } } });

    await expect(recordPostViewAction({ postId: POST_ID })).resolves.toEqual({ ok: true });
  });

  it("anónimo o payload roto sale en silencio, sin lanzar", async () => {
    useGuardFail("unauthenticated");
    await expect(recordPostViewAction({ postId: POST_ID })).resolves.toEqual({ ok: false });

    await expect(recordPostViewAction({ postId: "ups" })).resolves.toEqual({ ok: false });
  });
});
