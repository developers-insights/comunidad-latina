import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de EDITAR y ELIMINAR una publicación propia.
 *
 * Se testean las REGLAS, no el render: quién puede tocar qué, qué se guarda,
 * qué NO se toca nunca (las fotos), y que ningún camino lance al cliente.
 *
 * Aislamiento con el patrón del repo (`engagement-actions.test.ts`):
 * `vi.hoisted` + `vi.mock` + stub encadenable y thenable del query builder.
 * Nunca se toca Supabase real, ni OpenAI, ni el rate limiter en memoria.
 *
 * Garantías cubiertas:
 *  - Sólo el autor edita: un post ajeno rebota SIN escribir.
 *  - Sólo desde su comunidad: un post propio leído desde otro tenant rebota.
 *  - En revisión o retirado NO se edita (editar no esquiva la moderación).
 *  - El texto pasa por la MISMA validación y la MISMA moderación que al publicar,
 *    y un texto marcado manda la publicación de vuelta a revisión.
 *  - El UPDATE lleva `body` y `status`, nunca `media`.
 *  - Guardar el mismo texto no escribe (no se marca como editado lo que no cambió).
 *  - Eliminar exige confirmación explícita en el payload.
 *  - Eliminar se frena con una promoción paga activa, y también cuando NO SE PUDO
 *    saber si la hay (fail-closed: la cascade se llevaría el registro del pago).
 *  - Todo error de la base degrada a `{ ok: false, … }` legible, sin lanzar.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  moderateText: vi.fn(),
  enqueueModeration: vi.fn(),
  createAdminClient: vi.fn(),
  limit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/rate-limit", () => ({
  HOUR_MS: 3_600_000,
  limit: mocks.limit,
}));
vi.mock("@/lib/moderation", () => ({
  TIER_AUTO: 1,
  TIER_REVIEW: 2,
  TIER_HUMAN: 3,
  moderateText: mocks.moderateText,
  moderationTier: (score: number) => (score >= 70 ? 3 : score >= 30 ? 2 : 1),
  enqueueModeration: mocks.enqueueModeration,
}));

import { deletePostAction, editPostAction } from "./post-edit-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const STRANGER_ID = "88888888-8888-4888-8888-888888888888";
const POST_ID = "33333333-3333-4333-8333-333333333333";

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<
  Record<"insert" | "delete" | "select" | "update", OpResult | OpResult[]>
>;

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
function createSupabaseStub(config: Record<string, TableOps> = {}) {
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
      insert: record("insert"),
      delete: record("delete"),
      select: record("select"),
      update: record("update"),
      eq: passthrough("eq"),
      limit: passthrough("limit"),
      maybeSingle: vi.fn(() => Promise.resolve(result())),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  return { client: { from }, from, calls };
}

/** Fila de post que devuelve la lectura. Publicada, propia, con una foto. */
function postRow(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: POST_ID,
      author_id: USER_ID,
      tenant_id: TENANT_ID,
      status: "published",
      body: "texto original",
      media: ["tenant/user/foto.jpg"],
      ...overrides,
    },
  };
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

function callOf(stub: ReturnType<typeof createSupabaseStub>, table: string, method: string) {
  return stub.calls.find((call) => call.table === table && call.method === method);
}

function didWrite(stub: ReturnType<typeof createSupabaseStub>) {
  return stub.calls.some(
    (call) => call.method === "update" || call.method === "delete" || call.method === "insert",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 19, retryAfterMs: 0 });
  mocks.moderateText.mockResolvedValue({
    flagged: false,
    score: 0,
    categories: [],
    skipped: false,
  });
  mocks.enqueueModeration.mockResolvedValue({ ok: true });
  mocks.createAdminClient.mockReturnValue({});
});

/* ------------------------------ editPostAction ---------------------------- */

describe("editPostAction", () => {
  it("guarda el texto nuevo y NO toca las fotos", async () => {
    const stub = useGuardOk({
      posts: { select: [postRow()], update: [{ data: { id: POST_ID } }] },
    });

    const result = await editPostAction({ postId: POST_ID, body: "  texto corregido  " });

    expect(result).toEqual({ ok: true, status: "published", body: "texto corregido" });
    const update = callOf(stub, "posts", "update");
    expect(update?.args[0]).toEqual({ body: "texto corregido", status: "published" });
    // La garantía central de la decisión 1: `media` no viaja jamás.
    expect(Object.keys(update?.args[0] as object)).not.toContain("media");
  });

  it("el UPDATE va acotado por post, autor y comunidad (no confía solo en la RLS)", async () => {
    const stub = useGuardOk({
      posts: { select: [postRow()], update: [{ data: { id: POST_ID } }] },
    });

    await editPostAction({ postId: POST_ID, body: "otro texto" });

    const filters = stub.calls
      .filter((call) => call.table === "posts" && call.method === "eq")
      .map((call) => call.args);
    expect(filters).toEqual([
      ["id", POST_ID], // lectura
      ["id", POST_ID], // escritura
      ["author_id", USER_ID],
      ["tenant_id", TENANT_ID],
    ]);
  });

  it("una publicación AJENA no se edita y no se escribe nada", async () => {
    const stub = useGuardOk({ posts: { select: [postRow({ author_id: STRANGER_ID })] } });

    const result = await editPostAction({ postId: POST_ID, body: "me apropio de esto" });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: "forbidden" });
    expect(didWrite(stub)).toBe(false);
  });

  it("un post propio de OTRA comunidad tampoco se edita desde acá", async () => {
    // `posts_select` deja leer contenido published cross-tenant (SEO): sin el
    // chequeo explícito del servidor, esta fila llegaría hasta el UPDATE.
    const stub = useGuardOk({ posts: { select: [postRow({ tenant_id: OTHER_TENANT })] } });

    const result = await editPostAction({ postId: POST_ID, body: "texto nuevo" });

    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(didWrite(stub)).toBe(false);
  });

  it("una publicación EN REVISIÓN no se edita (editar no es la puerta de atrás)", async () => {
    const stub = useGuardOk({ posts: { select: [postRow({ status: "pending_review" })] } });

    const result = await editPostAction({ postId: POST_ID, body: "ahora sí, algo inocente" });

    expect(result).toMatchObject({ ok: false, code: "blocked" });
    expect(result.ok === false && result.message).toContain("en revisión");
    expect(didWrite(stub)).toBe(false);
    expect(mocks.moderateText).not.toHaveBeenCalled();
  });

  it("una publicación RETIRADA por moderación no se edita", async () => {
    const stub = useGuardOk({ posts: { select: [postRow({ status: "removed" })] } });

    const result = await editPostAction({ postId: POST_ID, body: "intento de resucitarla" });

    expect(result).toMatchObject({ ok: false, code: "blocked" });
    expect(didWrite(stub)).toBe(false);
  });

  it("el texto se valida igual que al publicar: vacío sin medio no pasa", async () => {
    const stub = useGuardOk({ posts: { select: [postRow({ media: [] })] } });

    const result = await editPostAction({ postId: POST_ID, body: "   " });

    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(didWrite(stub)).toBe(false);
  });

  it("con foto, vaciar el pie SÍ se puede (la foto es la publicación)", async () => {
    const stub = useGuardOk({
      posts: { select: [postRow()], update: [{ data: { id: POST_ID } }] },
    });

    const result = await editPostAction({ postId: POST_ID, body: "" });

    expect(result).toMatchObject({ ok: true });
    expect(callOf(stub, "posts", "update")?.args[0]).toEqual({ body: "", status: "published" });
  });

  it("un cuerpo de más de 2000 se rechaza ANTES del guard", async () => {
    const result = await editPostAction({ postId: POST_ID, body: "a".repeat(2001) });

    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("guardar el MISMO texto no escribe ni marca la publicación como editada", async () => {
    const stub = useGuardOk({ posts: { select: [postRow()] } });

    const result = await editPostAction({ postId: POST_ID, body: "texto original" });

    expect(result).toEqual({ ok: true, status: "published", body: "texto original" });
    expect(didWrite(stub)).toBe(false);
    expect(mocks.moderateText).not.toHaveBeenCalled();
  });

  it("un texto marcado por moderación manda la publicación de vuelta a revisión", async () => {
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      score: 91,
      categories: ["harassment"],
      skipped: false,
    });
    const stub = useGuardOk({
      posts: { select: [postRow()], update: [{ data: { id: POST_ID } }] },
    });

    const result = await editPostAction({ postId: POST_ID, body: "texto que no va" });

    expect(result).toMatchObject({ ok: true, status: "pending_review" });
    expect(callOf(stub, "posts", "update")?.args[0]).toEqual({
      body: "texto que no va",
      status: "pending_review",
    });
    // Quien revisa tiene que saber que esto CAMBIÓ después de publicarse.
    expect(mocks.enqueueModeration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subjectKind: "post",
        subjectId: POST_ID,
        tier: 3,
        reasons: ["post_edit", "harassment"],
      }),
    );
  });

  it("un score intermedio publica pero deja constancia en la cola", async () => {
    mocks.moderateText.mockResolvedValue({
      flagged: false,
      score: 45,
      categories: ["violence"],
      skipped: false,
    });
    useGuardOk({ posts: { select: [postRow()], update: [{ data: { id: POST_ID } }] } });

    const result = await editPostAction({ postId: POST_ID, body: "texto al límite" });

    expect(result).toMatchObject({ ok: true, status: "published" });
    expect(mocks.enqueueModeration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tier: 2, reasons: ["post_edit", "violence"] }),
    );
  });

  it("si la moderación no pudo correr, se publica pero se encola como no moderado", async () => {
    mocks.moderateText.mockResolvedValue({
      flagged: false,
      score: 0,
      categories: [],
      skipped: true,
    });
    useGuardOk({ posts: { select: [postRow()], update: [{ data: { id: POST_ID } }] } });

    await editPostAction({ postId: POST_ID, body: "texto sin moderar" });

    expect(mocks.enqueueModeration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        aiScore: null,
        reasons: ["post_edit", "moderation_skipped"],
      }),
    );
  });

  it("un fallo al encolar no rompe la edición ya guardada", async () => {
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      score: 90,
      categories: [],
      skipped: false,
    });
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("sin service role key");
    });
    useGuardOk({ posts: { select: [postRow()], update: [{ data: { id: POST_ID } }] } });

    await expect(
      editPostAction({ postId: POST_ID, body: "texto nuevo" }),
    ).resolves.toMatchObject({ ok: true, status: "pending_review" });
  });

  it("si la RLS rechaza el UPDATE no se dice 'listo'", async () => {
    // Sin fila devuelta la escritura no pasó, aunque no haya `error`.
    useGuardOk({ posts: { select: [postRow()], update: [{ data: null }] } });

    await expect(
      editPostAction({ postId: POST_ID, body: "texto nuevo" }),
    ).resolves.toMatchObject({ ok: false, code: "forbidden" });
  });

  it("un error de la base degrada sin lanzar", async () => {
    useGuardOk({
      posts: {
        select: [postRow()],
        update: [{ error: { code: "57014", message: "statement timeout" } }],
      },
    });

    await expect(
      editPostAction({ postId: POST_ID, body: "texto nuevo" }),
    ).resolves.toEqual({
      ok: false,
      code: "error",
      message: expect.stringContaining("no es tu culpa"),
    });
  });

  it("un error de LECTURA no se disfraza de 'no existe'", async () => {
    useGuardOk({ posts: { select: [{ error: { code: "57014" } }] } });

    await expect(
      editPostAction({ postId: POST_ID, body: "texto nuevo" }),
    ).resolves.toMatchObject({ ok: false, code: "error" });
  });

  it("un post invisible para la RLS se comporta como inexistente", async () => {
    useGuardOk({ posts: { select: [{ data: null }] } });

    await expect(
      editPostAction({ postId: POST_ID, body: "texto nuevo" }),
    ).resolves.toMatchObject({ ok: false, code: "not-found" });
  });

  it("sin sesión no se toca la base", async () => {
    const stub = useGuardFail("unauthenticated");

    const result = await editPostAction({ postId: POST_ID, body: "texto nuevo" });

    expect(result).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("desde otra comunidad se corta con el copy del guard", async () => {
    useGuardFail("tenant-mismatch");

    await expect(
      editPostAction({ postId: POST_ID, body: "texto nuevo" }),
    ).resolves.toEqual({
      ok: false,
      code: "tenant-mismatch",
      message: "copy del guard",
    });
  });

  it("un id que no es uuid se rechaza ANTES del guard", async () => {
    await expect(
      editPostAction({ postId: "no-es-uuid", body: "texto nuevo" }),
    ).resolves.toMatchObject({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("pasado el techo por hora se avisa sin culpar a la persona", async () => {
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 60_000 });
    const stub = useGuardOk({ posts: { select: [postRow()] } });

    const result = await editPostAction({ postId: POST_ID, body: "texto nuevo" });

    expect(result).toMatchObject({ ok: false, code: "rate-limited" });
    expect(result.ok === false && result.message).toContain("tu cuenta está bien");
    expect(stub.from).not.toHaveBeenCalled();
  });
});

/* ----------------------------- deletePostAction --------------------------- */

describe("deletePostAction", () => {
  it("elimina la publicación propia, acotando por post, autor y comunidad", async () => {
    const stub = useGuardOk({ posts: { select: [postRow()] } });

    const result = await deletePostAction({ postId: POST_ID, confirmed: true });

    expect(result).toEqual({ ok: true });
    expect(callOf(stub, "posts", "delete")).toBeDefined();
    const filters = stub.calls
      .filter((call) => call.table === "posts" && call.method === "eq")
      .map((call) => call.args);
    expect(filters).toEqual([
      ["id", POST_ID], // lectura
      ["id", POST_ID], // borrado
      ["author_id", USER_ID],
      ["tenant_id", TENANT_ID],
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/feed");
  });

  it("SIN confirmación explícita no borra nada, ni llama al guard", async () => {
    const result = await deletePostAction({
      postId: POST_ID,
      confirmed: false as unknown as true,
    });

    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("una publicación AJENA no se elimina", async () => {
    const stub = useGuardOk({ posts: { select: [postRow({ author_id: STRANGER_ID })] } });

    const result = await deletePostAction({ postId: POST_ID, confirmed: true });

    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(didWrite(stub)).toBe(false);
    // Ni siquiera se consulta si el post ajeno tiene promociones.
    expect(stub.calls.some((call) => call.table === "post_promotions")).toBe(false);
  });

  it("una publicación propia EN REVISIÓN sí se elimina: sigue siendo suya", async () => {
    const stub = useGuardOk({ posts: { select: [postRow({ status: "pending_review" })] } });

    await expect(
      deletePostAction({ postId: POST_ID, confirmed: true }),
    ).resolves.toEqual({ ok: true });
    expect(callOf(stub, "posts", "delete")).toBeDefined();
  });

  it("con una promoción paga ACTIVA no se elimina (la cascade se llevaría el pago)", async () => {
    const stub = useGuardOk({
      posts: { select: [postRow()] },
      post_promotions: { select: [{ data: { id: "promo-1" } }] },
    });

    const result = await deletePostAction({ postId: POST_ID, confirmed: true });

    expect(result).toMatchObject({ ok: false, code: "blocked" });
    expect(result.ok === false && result.message).toContain("promoción paga");
    expect(didWrite(stub)).toBe(false);
  });

  it("una campaña activa lo frena igual que una promoción", async () => {
    const stub = useGuardOk({
      posts: { select: [postRow()] },
      campaigns: { select: [{ data: { id: "camp-1" } }] },
    });

    await expect(
      deletePostAction({ postId: POST_ID, confirmed: true }),
    ).resolves.toMatchObject({ ok: false, code: "blocked" });
    expect(didWrite(stub)).toBe(false);
  });

  it("si NO se pudo saber si hay promoción, no borra (fail-closed)", async () => {
    // Borrar es irreversible: ante la duda se frena y se reintenta, en vez de
    // destruir el registro de algo que alguien pagó.
    const stub = useGuardOk({
      posts: { select: [postRow()] },
      post_promotions: { select: [{ error: { code: "57014" } }] },
    });

    await expect(
      deletePostAction({ postId: POST_ID, confirmed: true }),
    ).resolves.toMatchObject({ ok: false, code: "blocked" });
    expect(didWrite(stub)).toBe(false);
  });

  it("un error del DELETE degrada sin lanzar", async () => {
    useGuardOk({
      posts: { select: [postRow()], delete: { error: { code: "42501" } } },
    });

    await expect(
      deletePostAction({ postId: POST_ID, confirmed: true }),
    ).resolves.toMatchObject({ ok: false, code: "error" });
  });

  it("un post que ya no existe no es un error del sistema", async () => {
    useGuardOk({ posts: { select: [{ data: null }] } });

    await expect(
      deletePostAction({ postId: POST_ID, confirmed: true }),
    ).resolves.toMatchObject({ ok: false, code: "not-found" });
  });

  it("sin sesión no se toca la base", async () => {
    const stub = useGuardFail("unauthenticated");

    await expect(
      deletePostAction({ postId: POST_ID, confirmed: true }),
    ).resolves.toMatchObject({ ok: false, code: "unauthenticated" });
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("desde otra comunidad se corta con el copy del guard", async () => {
    useGuardFail("tenant-mismatch");

    await expect(
      deletePostAction({ postId: POST_ID, confirmed: true }),
    ).resolves.toEqual({
      ok: false,
      code: "tenant-mismatch",
      message: "copy del guard",
    });
  });
});
