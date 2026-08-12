import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de las actions de ETIQUETAR PERSONAS (0089).
 *
 * Se aíslan los bordes con el patrón del repo (engagement-actions.test.ts):
 * `vi.hoisted` + `vi.mock` + stub encadenable y "thenable". Nunca se toca
 * Supabase real, ni el emisor de notificaciones, ni el rate limiter global (que
 * es estado de módulo y contaminaría los tests entre sí).
 *
 * Garantías cubiertas:
 *  - Buscar: zod primero (una letra no llega ni al guard), va por RPC con la
 *    consulta saneada, y sin sesión no consulta nada.
 *  - Guardar: calcula el DIFF contra lo que ya hay — guardar dos veces la misma
 *    lista no inserta ni notifica de nuevo (el bug clásico de esta feature).
 *  - Guardar: la fila lleva tenant del guard y `tagged_by` del JWT, nunca del
 *    cliente.
 *  - Guardar: si la RLS rechaza el LOTE, se reintenta de a una y se informa
 *    quién quedó afuera — una preferencia ajena no puede tirar abajo el resto.
 *  - Guardar: el autor NO se auto-notifica al etiquetarse a sí mismo.
 *  - Guardar: ids duplicados se colapsan antes de contra el tope.
 *  - Quitar: sin `profileId` borra la fila propia (el derecho de la persona
 *    etiquetada), y cero filas borradas no es un error.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  createNotification: vi.fn(),
  createAdminClient: vi.fn(() => ({ admin: true })),
  limit: vi.fn(() => ({ ok: true, remaining: 9, retryAfterMs: 0 })),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notifications/notify", () => ({
  createNotification: mocks.createNotification,
}));
vi.mock("@/lib/rate-limit", () => ({
  limit: mocks.limit,
  HOUR_MS: 3_600_000,
  DAY_MS: 86_400_000,
}));

import {
  removeTagAction,
  saveTagsAction,
  searchTaggableMembersAction,
} from "./tag-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const ANA_ID = "44444444-4444-4444-8444-444444444444";
const PEDRO_ID = "55555555-5555-4555-8555-555555555555";

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<
  Record<"insert" | "delete" | "select", OpResult | OpResult[]>
>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createSupabaseStub(
  config: Record<string, TableOps> = {},
  rpcResults: Record<string, OpResult> = {},
) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const result = (): OpResult => {
      if (!op) return { error: null };
      const configured = tableConfig[op];
      if (Array.isArray(configured)) return configured.shift() ?? { error: null };
      return configured ?? { error: null };
    };

    const record = (method: keyof TableOps) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        op = method;
        return builder;
      });

    const passthrough = (method: string) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: record("insert"),
      delete: record("delete"),
      select: record("select"),
      eq: passthrough("eq"),
      in: passthrough("in"),
      maybeSingle: vi.fn(() => Promise.resolve(result())),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  const rpc = vi.fn((name: string, args: unknown) => {
    calls.push({ table: `rpc:${name}`, method: "rpc", args: [args] });
    return Promise.resolve(rpcResults[name] ?? { data: [], error: null });
  });

  return { client: { from, rpc }, from, rpc, calls };
}

function useGuardOk(
  config: Record<string, TableOps> = {},
  rpcResults: Record<string, OpResult> = {},
) {
  const stub = createSupabaseStub(config, rpcResults);
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

function insertCalls(stub: ReturnType<typeof createSupabaseStub>, table: string) {
  return stub.calls.filter((call) => call.table === table && call.method === "insert");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true, remaining: 9, retryAfterMs: 0 });
  mocks.createAdminClient.mockReturnValue({ admin: true });
  mocks.createNotification.mockResolvedValue({ ok: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* ------------------------ searchTaggableMembersAction ---------------------- */

describe("searchTaggableMembersAction", () => {
  it("una sola letra no llega ni al guard (zod puro primero)", async () => {
    const result = await searchTaggableMembersAction({ query: "a" });
    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("busca por RPC con la consulta trimmeada y mapea la fila", async () => {
    const stub = useGuardOk({}, {
      search_taggable_members: {
        data: [{ id: ANA_ID, display_name: "Ana Peña", avatar_url: "ana.jpg" }],
      },
    });

    const result = await searchTaggableMembersAction({ query: "  ana  " });

    expect(result).toEqual({
      ok: true,
      people: [{ id: ANA_ID, displayName: "Ana Peña", avatarUrl: "ana.jpg" }],
    });
    expect(stub.rpc).toHaveBeenCalledWith("search_taggable_members", {
      q: "ana",
      max_results: 8,
    });
  });

  it("sin sesión no consulta a nadie", async () => {
    const stub = useGuardFail("unauthenticated");
    const result = await searchTaggableMembersAction({ query: "ana" });
    expect(result).toEqual({ ok: false, code: "unauthenticated" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("con el techo consumido no gasta una RPC", async () => {
    const stub = useGuardOk();
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });
    const result = await searchTaggableMembersAction({ query: "ana" });
    expect(result).toEqual({ ok: false, code: "rate-limited" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });
});

/* ------------------------------ saveTagsAction ----------------------------- */

describe("saveTagsAction", () => {
  it("inserta con el tenant del guard y el autor del JWT, y avisa", async () => {
    const stub = useGuardOk({ post_tags: { select: { data: [] } } });

    const result = await saveTagsAction({ postId: POST_ID, profileIds: [ANA_ID] });

    expect(result).toEqual({ ok: true, tagged: [ANA_ID], rejected: [] });
    expect(insertCalls(stub, "post_tags")[0].args[0]).toEqual([
      {
        tenant_id: TENANT_ID,
        post_id: POST_ID,
        profile_id: ANA_ID,
        tagged_by: USER_ID,
      },
    ]);
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
    expect(mocks.createNotification.mock.calls[0][1]).toMatchObject({
      tenantId: TENANT_ID,
      profileId: ANA_ID,
      kind: "tag",
      category: "social",
      href: `/feed/${POST_ID}`,
      dedupeUnread: true,
    });
  });

  it("guardar la MISMA lista dos veces no inserta ni vuelve a notificar", async () => {
    const stub = useGuardOk({
      post_tags: { select: { data: [{ profile_id: ANA_ID }] } },
    });

    const result = await saveTagsAction({ postId: POST_ID, profileIds: [ANA_ID] });

    expect(result).toEqual({ ok: true, tagged: [ANA_ID], rejected: [] });
    expect(insertCalls(stub, "post_tags")).toHaveLength(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("quitar a alguien borra sólo su fila y no notifica a nadie", async () => {
    const stub = useGuardOk({
      post_tags: { select: { data: [{ profile_id: ANA_ID }, { profile_id: PEDRO_ID }] } },
    });

    const result = await saveTagsAction({ postId: POST_ID, profileIds: [PEDRO_ID] });

    expect(result).toEqual({ ok: true, tagged: [PEDRO_ID], rejected: [] });
    const deleteIn = stub.calls.find(
      (call) => call.table === "post_tags" && call.method === "in",
    );
    expect(deleteIn?.args).toEqual(["profile_id", [ANA_ID]]);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("si la RLS rechaza el lote, reintenta de a una e informa quién quedó afuera", async () => {
    const stub = useGuardOk({
      post_tags: {
        select: { data: [] },
        insert: [
          { error: { code: "42501" } }, // el lote entero rebota
          { error: null }, // Ana sí entra
          { error: { code: "42501" } }, // Pedro no acepta etiquetas
        ],
      },
    });

    const result = await saveTagsAction({
      postId: POST_ID,
      profileIds: [ANA_ID, PEDRO_ID],
    });

    expect(result).toEqual({ ok: true, tagged: [ANA_ID], rejected: [PEDRO_ID] });
    // Sólo se avisa a quien realmente quedó etiquetado.
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
    expect(mocks.createNotification.mock.calls[0][1]).toMatchObject({ profileId: ANA_ID });
    expect(insertCalls(stub, "post_tags")).toHaveLength(3);
  });

  it("el autor que se etiqueta a sí mismo no se auto-notifica", async () => {
    useGuardOk({ post_tags: { select: { data: [] } } });

    const result = await saveTagsAction({ postId: POST_ID, profileIds: [USER_ID] });

    expect(result).toEqual({ ok: true, tagged: [USER_ID], rejected: [] });
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("ids repetidos se colapsan antes de mirar el tope", async () => {
    const stub = useGuardOk({ post_tags: { select: { data: [] } } });

    const result = await saveTagsAction({
      postId: POST_ID,
      profileIds: [ANA_ID, ANA_ID, ANA_ID],
    });

    expect(result).toEqual({ ok: true, tagged: [ANA_ID], rejected: [] });
    expect(insertCalls(stub, "post_tags")[0].args[0]).toHaveLength(1);
  });

  it("más de 20 personas ni siquiera llega al guard", async () => {
    const many = Array.from(
      { length: 21 },
      (_, index) => `1111111${index.toString().padStart(1, "0")}-1111-4111-8111-11111111111${index % 10}`,
    );
    const result = await saveTagsAction({ postId: POST_ID, profileIds: many });
    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("divergencia de tenant devuelve el copy del guard y no escribe", async () => {
    const stub = useGuardFail("tenant-mismatch");
    const result = await saveTagsAction({ postId: POST_ID, profileIds: [ANA_ID] });
    expect(result).toEqual({
      ok: false,
      code: "tenant-mismatch",
      message: "copy del guard",
    });
    expect(insertCalls(stub, "post_tags")).toHaveLength(0);
  });

  it("un error inesperado del insert devuelve lo que SÍ quedó guardado", async () => {
    useGuardOk({
      post_tags: {
        select: { data: [{ profile_id: PEDRO_ID }] },
        insert: { error: { code: "08006" } }, // caída de conexión, no RLS
      },
    });

    const result = await saveTagsAction({
      postId: POST_ID,
      profileIds: [PEDRO_ID, ANA_ID],
    });

    expect(result).toEqual({ ok: false, code: "error", tagged: [PEDRO_ID] });
  });
});

/* ----------------------------- removeTagAction ----------------------------- */

describe("removeTagAction", () => {
  it("sin profileId borra la fila PROPIA (el derecho de quien fue etiquetada)", async () => {
    const stub = useGuardOk();

    const result = await removeTagAction({ postId: POST_ID });

    expect(result).toEqual({ ok: true });
    const eqCalls = stub.calls.filter(
      (call) => call.table === "post_tags" && call.method === "eq",
    );
    expect(eqCalls.map((call) => call.args)).toEqual([
      ["post_id", POST_ID],
      ["profile_id", USER_ID],
    ]);
  });

  it("el autor puede quitar la etiqueta de otra persona", async () => {
    const stub = useGuardOk();

    await removeTagAction({ postId: POST_ID, profileId: ANA_ID });

    const eqCalls = stub.calls.filter(
      (call) => call.table === "post_tags" && call.method === "eq",
    );
    expect(eqCalls[1].args).toEqual(["profile_id", ANA_ID]);
  });

  it("cero filas borradas no es un error", async () => {
    useGuardOk({ post_tags: { delete: { error: null, data: [] } } });
    expect(await removeTagAction({ postId: POST_ID })).toEqual({ ok: true });
  });

  it("un postId que no es uuid no llega al guard", async () => {
    expect(await removeTagAction({ postId: "no-soy-uuid" })).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});
