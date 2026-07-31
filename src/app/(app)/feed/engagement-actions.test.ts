import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de las actions de ENGAGEMENT (guardar / vista de reel / voto en encuesta).
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
 *  - Vista de AVISO: mismo contrato que la de post (0050), incluida la
 *    tolerancia al 23505 — que en el detalle de un aviso es el caso normal.
 *  - Compartir un aviso va por RPC (las policies de escritura de listing_shares
 *    están en false) y sin sesión no llama a nadie.
 *  - Votar: solo en `kind='question'` CON `poll_kind` (el cliente no elige dónde
 *    se puede votar), UPSERT sobre (post, votante) para que cambiar de opinión no
 *    duplique, y degradación limpia si la 0041 todavía no está aplicada.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));

import {
  recordListingShareAction,
  recordListingViewAction,
  recordPostViewAction,
  toggleSaveAction,
  votePostPollAction,
} from "./engagement-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const LISTING_ID = "55555555-5555-4555-8555-555555555555";

type OpResult = { data?: unknown; error?: unknown };
/**
 * Un valor por operación, o una COLA cuando la misma tabla se lee dos veces en
 * la misma action (votar lee `posts` para validar y otra vez para los contadores
 * que dejó el trigger).
 */
type TableOps = Partial<
  Record<"insert" | "delete" | "select" | "upsert", OpResult | OpResult[]>
>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/** Query builder falso, encadenable y thenable (patrón route.test.ts de Stripe). */
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: record("insert"),
      delete: record("delete"),
      select: record("select"),
      upsert: record("upsert"),
      eq: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        return builder;
      }),
      maybeSingle: vi.fn(() => Promise.resolve(result())),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  // Las RPC no pasan por el builder: se resuelven de una. Se registran con
  // `table: "rpc:<nombre>"` para poder afirmar el nombre Y los argumentos.
  const rpc = vi.fn((name: string, args: unknown) => {
    calls.push({ table: `rpc:${name}`, method: "rpc", args: [args] });
    return Promise.resolve(rpcResults[name] ?? { error: null });
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

/* -------------------------- recordListingViewAction ------------------------ */

describe("recordListingViewAction", () => {
  it("registra la vista del aviso con el viewer y el tenant del guard", async () => {
    const stub = useGuardOk();

    await expect(recordListingViewAction({ listingId: LISTING_ID })).resolves.toEqual({
      ok: true,
    });
    expect(insertedRow(stub, "listing_views")).toEqual({
      tenant_id: TENANT_ID,
      listing_id: LISTING_ID,
      viewer_id: USER_ID,
    });
  });

  it("volver a abrir el aviso el mismo día (23505) no es una falla", async () => {
    // En el detalle de un aviso éste es el caso FRECUENTE, no el raro: la PK
    // (aviso, persona, día) es la deduplicación y el conflicto es el éxito.
    useGuardOk({ listing_views: { insert: { error: { code: "23505" } } } });

    await expect(recordListingViewAction({ listingId: LISTING_ID })).resolves.toEqual({
      ok: true,
    });
  });

  it("un error real de la base sí devuelve ok:false", async () => {
    useGuardOk({ listing_views: { insert: { error: { code: "42501" } } } });

    await expect(recordListingViewAction({ listingId: LISTING_ID })).resolves.toEqual({
      ok: false,
    });
  });

  it("anónimo o payload roto sale en silencio, sin escribir", async () => {
    const stub = useGuardFail("unauthenticated");
    await expect(recordListingViewAction({ listingId: LISTING_ID })).resolves.toEqual({
      ok: false,
    });
    expect(stub.from).not.toHaveBeenCalled();

    await expect(recordListingViewAction({ listingId: "ups" })).resolves.toEqual({
      ok: false,
    });
  });
});

/* ------------------------- recordListingShareAction ------------------------ */

describe("recordListingShareAction", () => {
  it("suma la compartida por RPC, no por insert directo", async () => {
    // `listing_shares` tiene las 3 policies de escritura en false: si esta
    // action dejara de ir por la RPC, la métrica se caería en silencio.
    const stub = useGuardOk();

    await recordListingShareAction({ listingId: LISTING_ID });

    expect(stub.rpc).toHaveBeenCalledWith("record_listing_share", {
      p_listing_id: LISTING_ID,
    });
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("un fallo de la RPC no lanza: compartir ya funcionó", async () => {
    useGuardOk({}, { record_listing_share: { error: { code: "P0001" } } });

    await expect(
      recordListingShareAction({ listingId: LISTING_ID }),
    ).resolves.toBeUndefined();
  });

  it("sin sesión no llama a la RPC", async () => {
    const stub = useGuardFail("unauthenticated");

    await recordListingShareAction({ listingId: LISTING_ID });

    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("rechaza un id que no es uuid ANTES de tocar el guard", async () => {
    const stub = useGuardOk();

    await recordListingShareAction({ listingId: "ups" });

    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
    expect(stub.rpc).not.toHaveBeenCalled();
  });
});

/* ---------------------------- votePostPollAction --------------------------- */

describe("votePostPollAction", () => {
  /** Fila que devuelve la lectura de validación de una pregunta CON encuesta. */
  const QUESTION_WITH_POLL = {
    data: { id: POST_ID, kind: "question", poll_kind: "yes_no" },
  };

  function votedRow(stub: ReturnType<typeof createSupabaseStub>) {
    return stub.calls.find(
      (call) => call.table === "post_poll_votes" && call.method === "upsert",
    );
  }

  it("registra el voto y devuelve los contadores frescos del trigger", async () => {
    const stub = useGuardOk({
      posts: {
        select: [
          QUESTION_WITH_POLL,
          { data: { poll_yes_count: 31, poll_no_count: 50 } },
        ],
      },
    });

    const result = await votePostPollAction({ postId: POST_ID, choice: true });

    expect(result).toEqual({ ok: true, choice: true, yes: 31, no: 50 });
    expect(votedRow(stub)?.args[0]).toEqual({
      post_id: POST_ID,
      voter_id: USER_ID,
      choice: true,
    });
  });

  it("es un UPSERT sobre (post, votante): cambiar de opinión no crea otra fila", async () => {
    const stub = useGuardOk({
      posts: { select: [QUESTION_WITH_POLL, { data: null }] },
    });

    await votePostPollAction({ postId: POST_ID, choice: false });

    expect(votedRow(stub)?.args[1]).toEqual({ onConflict: "post_id,voter_id" });
    // Nada de insert a secas: eso rebotaría con la PK en el segundo voto.
    expect(
      stub.calls.some(
        (call) => call.table === "post_poll_votes" && call.method === "insert",
      ),
    ).toBe(false);
  });

  it("si no se pudieron releer los contadores, el voto igual vale", async () => {
    useGuardOk({ posts: { select: [QUESTION_WITH_POLL, { data: null }] } });

    await expect(
      votePostPollAction({ postId: POST_ID, choice: true }),
    ).resolves.toEqual({ ok: true, choice: true, yes: null, no: null });
  });

  it("un post que NO es pregunta se rechaza SIN escribir el voto", async () => {
    const stub = useGuardOk({
      posts: { select: [{ data: { id: POST_ID, kind: "post", poll_kind: null } }] },
    });

    const result = await votePostPollAction({ postId: POST_ID, choice: true });

    expect(result).toEqual({ ok: false, code: "not-poll" });
    expect(stub.calls.some((call) => call.table === "post_poll_votes")).toBe(false);
  });

  it("una pregunta SIN encuesta tampoco acepta votos", async () => {
    const stub = useGuardOk({
      posts: { select: [{ data: { id: POST_ID, kind: "question", poll_kind: null } }] },
    });

    const result = await votePostPollAction({ postId: POST_ID, choice: false });

    expect(result).toEqual({ ok: false, code: "not-poll" });
    expect(stub.calls.some((call) => call.table === "post_poll_votes")).toBe(false);
  });

  it("un post invisible para la RLS se comporta como inexistente", async () => {
    useGuardOk({ posts: { select: [{ data: null }] } });

    await expect(
      votePostPollAction({ postId: POST_ID, choice: true }),
    ).resolves.toEqual({ ok: false, code: "not-poll" });
  });

  it("un fallo real de lectura NO se disfraza de 'acá no se vota'", async () => {
    // "not-poll" es una respuesta sobre el post ("esto no tiene encuesta"); un
    // error de la base es una respuesta sobre el sistema. Confundirlos le enseña
    // a la persona que su pregunta no tiene encuesta cuando en realidad la tiene
    // y lo que falló fue el servidor.
    useGuardOk({
      posts: { select: [{ error: { code: "57014", message: "statement timeout" } }] },
    });

    await expect(
      votePostPollAction({ postId: POST_ID, choice: true }),
    ).resolves.toEqual({ ok: false, code: "error" });
  });

  it("sin sesión devuelve 'unauthenticated' y no toca la base", async () => {
    const stub = useGuardFail("unauthenticated");

    const result = await votePostPollAction({ postId: POST_ID, choice: true });

    expect(result).toEqual({ ok: false, code: "unauthenticated" });
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("otra comunidad: se corta con el copy del guard", async () => {
    useGuardFail("tenant-mismatch");

    await expect(
      votePostPollAction({ postId: POST_ID, choice: true }),
    ).resolves.toEqual({
      ok: false,
      code: "tenant-mismatch",
      message: "copy del guard",
    });
  });

  it("un payload roto se rechaza ANTES del guard (zod puro primero)", async () => {
    await expect(
      votePostPollAction({ postId: "no-es-uuid", choice: true }),
    ).resolves.toEqual({ ok: false, code: "invalid" });
    await expect(
      votePostPollAction({ postId: POST_ID, choice: "sí" as unknown as boolean }),
    ).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});
