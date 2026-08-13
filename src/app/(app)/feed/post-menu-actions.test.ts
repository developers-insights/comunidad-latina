import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del MENÚ ⋯ de una publicación (migración 0097): fijar, ocultar del feed,
 * desactivar comentarios y eliminar un comentario.
 *
 * Lo que se testea es la AUTORIZACIÓN y que ningún camino escriba de más. El
 * mismo juego de reglas está probado además contra la base real —con sesiones
 * simuladas por rol y `rollback`— al aplicar la migración; esto es la red que
 * queda en el repo y corre en cada cambio.
 *
 * Aislamiento con el patrón del repo (`post-edit-actions.test.ts`): `vi.hoisted`
 * + `vi.mock` + stub encadenable y thenable del query builder, más `rpc`. Nunca
 * se toca Supabase real ni el rate limiter en memoria.
 *
 * Garantías cubiertas:
 *  - Un usuario NO puede fijar, ocultar ni cerrar los comentarios del post de
 *    OTRA persona: rebota SIN llamar a la RPC y SIN escribir.
 *  - Tampoco puede sobre un post propio leído desde OTRA comunidad.
 *  - Una publicación en revisión o retirada no se administra.
 *  - Ocultar DESFIJA en la misma escritura (fijada y oculta es un estado
 *    imposible, y el CHECK de la base lo rechazaría).
 *  - Los códigos que devuelve la base (`esta_oculta`, `no_disponible`…) llegan
 *    al cliente traducidos, nunca crudos.
 *  - Eliminar un comentario exige confirmación explícita en el payload, y cero
 *    filas borradas es un RECHAZO, no un éxito silencioso.
 *  - Todo error de la base degrada a `{ ok: false, … }` legible, sin lanzar.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/rate-limit", () => ({ HOUR_MS: 3_600_000, limit: mocks.limit }));

import {
  deleteCommentAction,
  toggleCommentsLockedAction,
  toggleHidePostAction,
  togglePinPostAction,
} from "./post-menu-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const STRANGER_ID = "88888888-8888-4888-8888-888888888888";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "44444444-4444-4444-8444-444444444444";

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<Record<"select" | "update" | "delete", OpResult>>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/**
 * Builder falso. La operación de cada cadena la define el PRIMER método que se
 * llama: en `update(…).select("id")` el `select` es una proyección, no otra
 * operación, y confundirlos haría que el test leyera la config equivocada.
 */
function createSupabaseStub(
  config: Record<string, TableOps> = {},
  rpcResult: OpResult = { data: "ok" },
) {
  const calls: RecordedCall[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const result = (): OpResult => (op ? (tableConfig[op] ?? { error: null }) : { error: null });

    const record = (method: keyof TableOps) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        op ??= method;
        return builder;
      });

    const passthrough = (method: string) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: record("select"),
      update: record("update"),
      delete: record("delete"),
      eq: passthrough("eq"),
      limit: passthrough("limit"),
      maybeSingle: vi.fn(() => Promise.resolve(result())),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  const rpc = vi.fn((fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    return Promise.resolve(rpcResult);
  });

  return { client: { from, rpc }, from, rpc, calls, rpcCalls };
}

/** Fila de post que devuelve la lectura. Publicada, propia, sin marcas puestas. */
function postRow(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: POST_ID,
      author_id: USER_ID,
      tenant_id: TENANT_ID,
      status: "published",
      pinned_at: null,
      hidden_at: null,
      comments_locked_at: null,
      ...overrides,
    },
  };
}

function useGuardOk(config: Record<string, TableOps> = {}, rpcResult: OpResult = { data: "ok" }) {
  const stub = createSupabaseStub(config, rpcResult);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

function didWrite(stub: ReturnType<typeof createSupabaseStub>) {
  return (
    stub.calls.some((call) => call.method === "update" || call.method === "delete") ||
    stub.rpcCalls.length > 0
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 59, retryAfterMs: 0 });
});

/* ------------------------- Autorización: por rol -------------------------- */

describe("autorización — el post de otra persona no se toca", () => {
  it("fijar: rebota sin llamar a la RPC", async () => {
    const stub = useGuardOk({
      posts: { select: postRow({ author_id: STRANGER_ID }) },
    });

    const result = await togglePinPostAction({ postId: POST_ID, pin: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("denied");
    expect(didWrite(stub)).toBe(false);
  });

  it("ocultar: rebota sin escribir", async () => {
    const stub = useGuardOk({
      posts: { select: postRow({ author_id: STRANGER_ID }) },
    });

    const result = await toggleHidePostAction({ postId: POST_ID, hide: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("denied");
    expect(didWrite(stub)).toBe(false);
  });

  it("desactivar comentarios: rebota sin escribir", async () => {
    const stub = useGuardOk({
      posts: { select: postRow({ author_id: STRANGER_ID }) },
    });

    const result = await toggleCommentsLockedAction({ postId: POST_ID, lock: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("denied");
    expect(didWrite(stub)).toBe(false);
  });

  it("post propio pero leído desde OTRA comunidad: rebota", async () => {
    const stub = useGuardOk({
      posts: { select: postRow({ tenant_id: OTHER_TENANT }) },
    });

    const result = await togglePinPostAction({ postId: POST_ID, pin: true });

    expect(result.ok).toBe(false);
    expect(didWrite(stub)).toBe(false);
  });

  it("publicación en revisión: no se administra", async () => {
    const stub = useGuardOk({
      posts: { select: postRow({ status: "pending_review" }) },
    });

    const result = await toggleHidePostAction({ postId: POST_ID, hide: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("revisión");
    expect(didWrite(stub)).toBe(false);
  });

  it("sin sesión: no se lee ni se escribe nada", async () => {
    const stub = createSupabaseStub();
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "copy del guard",
      supabase: stub.client,
      user: null,
    });

    const result = await togglePinPostAction({ postId: POST_ID, pin: true });

    expect(result.ok === false && result.code).toBe("unauthenticated");
    expect(stub.calls).toHaveLength(0);
  });
});

/* ------------------------------ Fijar ------------------------------------ */

describe("fijar", () => {
  it("llama a la RPC con el post y el sentido del toggle", async () => {
    const stub = useGuardOk({ posts: { select: postRow() } });

    const result = await togglePinPostAction({ postId: POST_ID, pin: true });

    expect(result.ok).toBe(true);
    expect(stub.rpcCalls).toEqual([
      { fn: "fijar_publicacion", args: { p_post: POST_ID, p_fijar: true } },
    ]);
  });

  it("desfijar viaja como p_fijar false", async () => {
    const stub = useGuardOk({ posts: { select: postRow({ pinned_at: "2026-08-13T10:00:00Z" }) } });

    await togglePinPostAction({ postId: POST_ID, pin: false });

    expect(stub.rpcCalls[0]?.args).toEqual({ p_post: POST_ID, p_fijar: false });
  });

  it("la base dice que está oculta: el motivo llega traducido, no crudo", async () => {
    useGuardOk({ posts: { select: postRow({ hidden_at: "2026-08-13T10:00:00Z" }) } }, {
      data: "esta_oculta",
    });

    const result = await togglePinPostAction({ postId: POST_ID, pin: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("denied");
    expect(result.ok === false && result.message).not.toContain("esta_oculta");
    expect(result.ok === false && result.message).toContain("oculta");
  });

  it("un código desconocido de la base NO se lee como éxito", async () => {
    useGuardOk({ posts: { select: postRow() } }, { data: "algo_nuevo" });

    const result = await togglePinPostAction({ postId: POST_ID, pin: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("error");
  });

  it("error de la base: degrada a resultado legible, no lanza", async () => {
    useGuardOk({ posts: { select: postRow() } }, { error: { code: "PGRST301" } });

    const result = await togglePinPostAction({ postId: POST_ID, pin: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("error");
  });
});

/* ------------------------------ Ocultar ---------------------------------- */

describe("ocultar del feed", () => {
  it("ocultar DESFIJA en la misma escritura (fijada + oculta es imposible)", async () => {
    const stub = useGuardOk({
      posts: {
        select: postRow({ pinned_at: "2026-08-13T10:00:00Z" }),
        update: { data: { id: POST_ID } },
      },
    });

    const result = await toggleHidePostAction({ postId: POST_ID, hide: true });

    expect(result.ok).toBe(true);
    const update = stub.calls.find((call) => call.method === "update");
    const payload = update?.args[0] as Record<string, unknown>;
    expect(payload.pinned_at).toBeNull();
    expect(typeof payload.hidden_at).toBe("string");
  });

  it("volver a mostrar NO vuelve a fijar", async () => {
    const stub = useGuardOk({
      posts: {
        select: postRow({ hidden_at: "2026-08-13T10:00:00Z" }),
        update: { data: { id: POST_ID } },
      },
    });

    await toggleHidePostAction({ postId: POST_ID, hide: false });

    const update = stub.calls.find((call) => call.method === "update");
    expect(update?.args[0]).toEqual({ hidden_at: null });
  });

  it("el UPDATE va acotado por id + autor + tenant", async () => {
    const stub = useGuardOk({
      posts: { select: postRow(), update: { data: { id: POST_ID } } },
    });

    await toggleHidePostAction({ postId: POST_ID, hide: true });

    const eqs = stub.calls
      .filter((call) => call.method === "eq")
      .map((call) => call.args as [string, unknown]);
    expect(eqs).toEqual(
      expect.arrayContaining([
        ["id", POST_ID],
        ["author_id", USER_ID],
        ["tenant_id", TENANT_ID],
      ]),
    );
  });

  it("cero filas devueltas (la RLS rechazó): NO se dice que salió bien", async () => {
    useGuardOk({ posts: { select: postRow(), update: { data: null } } });

    const result = await toggleHidePostAction({ postId: POST_ID, hide: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("denied");
  });
});

/* ------------------------ Desactivar comentarios -------------------------- */

describe("desactivar comentarios", () => {
  it("cerrar escribe una fecha; abrir escribe null", async () => {
    const cerrar = useGuardOk({
      posts: { select: postRow(), update: { data: { id: POST_ID } } },
    });
    await toggleCommentsLockedAction({ postId: POST_ID, lock: true });
    const cerrado = cerrar.calls.find((call) => call.method === "update")
      ?.args[0] as Record<string, unknown>;
    expect(typeof cerrado.comments_locked_at).toBe("string");

    const abrir = useGuardOk({
      posts: {
        select: postRow({ comments_locked_at: "2026-08-13T10:00:00Z" }),
        update: { data: { id: POST_ID } },
      },
    });
    await toggleCommentsLockedAction({ postId: POST_ID, lock: false });
    expect(
      abrir.calls.find((call) => call.method === "update")?.args[0],
    ).toEqual({ comments_locked_at: null });
  });

  it("no borra ni toca los comentarios que ya existen", async () => {
    const stub = useGuardOk({
      posts: { select: postRow(), update: { data: { id: POST_ID } } },
    });

    await toggleCommentsLockedAction({ postId: POST_ID, lock: true });

    expect(stub.calls.some((call) => call.table === "comments")).toBe(false);
  });
});

/* ------------------------- Eliminar un comentario ------------------------- */

describe("eliminar un comentario", () => {
  it("sin confirmación explícita no borra nada", async () => {
    const stub = useGuardOk();

    const result = await deleteCommentAction({
      commentId: COMMENT_ID,
      // @ts-expect-error — es exactamente la llamada mal cableada que el
      // `z.literal(true)` existe para frenar.
      confirmed: false,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("invalid");
    expect(didWrite(stub)).toBe(false);
  });

  it("borra acotando por id y por comunidad", async () => {
    const stub = useGuardOk({ comments: { delete: { data: [{ id: COMMENT_ID }] } } });

    const result = await deleteCommentAction({ commentId: COMMENT_ID, confirmed: true });

    expect(result.ok).toBe(true);
    const eqs = stub.calls
      .filter((call) => call.method === "eq")
      .map((call) => call.args as [string, unknown]);
    expect(eqs).toEqual(
      expect.arrayContaining([
        ["id", COMMENT_ID],
        ["tenant_id", TENANT_ID],
      ]),
    );
  });

  it("cero filas borradas es un RECHAZO, no un éxito silencioso", async () => {
    useGuardOk({ comments: { delete: { data: [] } } });

    const result = await deleteCommentAction({ commentId: COMMENT_ID, confirmed: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("denied");
    expect(result.ok === false && result.message).toContain("eliminar");
  });

  it("error de la base: resultado legible, sin lanzar", async () => {
    useGuardOk({ comments: { delete: { error: { code: "42501" } } } });

    const result = await deleteCommentAction({ commentId: COMMENT_ID, confirmed: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("error");
  });

  it("con el tope por hora agotado no se borra nada", async () => {
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });
    const stub = useGuardOk({ comments: { delete: { data: [{ id: COMMENT_ID }] } } });

    const result = await deleteCommentAction({ commentId: COMMENT_ID, confirmed: true });

    expect(result.ok === false && result.code).toBe("rate-limited");
    expect(didWrite(stub)).toBe(false);
  });
});
