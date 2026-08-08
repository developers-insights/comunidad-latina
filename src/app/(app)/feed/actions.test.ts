import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VALIDACIÓN DE `createPostAction` — la frontera real de "el texto es opcional
 * cuando hay foto o video" (feedback cliente 2026-08-05: "si la persona no
 * quiere subir ningún texto relacionado, que le deje publicar").
 *
 * El botón del composer es una comodidad; ESTE archivo es el contrato. Un
 * cliente viejo, un script o una pestaña con JS modificado entran por acá, así
 * que la matriz se prueba entera contra la action, no contra el helper:
 *
 *   cuerpo \ medio │ con foto/video          │ sin medio
 *   ───────────────┼─────────────────────────┼──────────────────────────
 *   vacío          │ PUBLICA                 │ rechaza (photo | invalid)
 *   1 carácter     │ rechaza `invalid`       │ rechaza `invalid`
 *   ≥ 2            │ PUBLICA                 │ PUBLICA (text/question)
 *   > 2000         │ rechaza `invalid`       │ rechaza `invalid`
 *
 * Los bordes se aíslan con el patrón del repo (engagement-actions.test.ts):
 * `vi.hoisted` + `vi.mock` + stub encadenable del query builder. Nunca se toca
 * Supabase, OpenAI ni Storage de verdad.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  moderateText: vi.fn(),
  enqueueModeration: vi.fn(),
  limit: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
// Sin Google Vision: es la configuración real de producción hoy — la foto se
// publica al instante y entra a la cola humana para revisión asíncrona.
vi.mock("@/lib/config/services", () => ({ isVisionConfigured: false }));
vi.mock("@/lib/moderation", () => ({
  TIER_AUTO: 1,
  TIER_REVIEW: 2,
  TIER_HUMAN: 3,
  moderationTier: () => 1,
  moderateText: mocks.moderateText,
  enqueueModeration: mocks.enqueueModeration,
}));

import { createPostAction } from "./actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const NEW_POST_ID = "33333333-3333-4333-8333-333333333333";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/**
 * Query builder falso, encadenable, con `storage` para la subida de fotos.
 * `insert(...).select("id").single()` es la única cadena que usa la action.
 */
function createSupabaseStub(insertError: unknown = null, uploadError: unknown = null) {
  const calls: RecordedCall[] = [];
  const uploads: Array<{ path: string; contentType?: string }> = [];

  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        return builder;
      }),
      select: vi.fn(() => builder),
      single: vi.fn(() =>
        Promise.resolve(
          insertError
            ? { data: null, error: insertError }
            : { data: { id: NEW_POST_ID }, error: null },
        ),
      ),
    };
    return builder;
  });

  const storage = {
    from: vi.fn(() => ({
      upload: vi.fn((path: string, _file: unknown, options?: { contentType?: string }) => {
        uploads.push({ path, contentType: options?.contentType });
        return Promise.resolve({ error: uploadError });
      }),
    })),
  };

  return { client: { from, storage }, from, calls, uploads };
}

function useGuardOk(insertError: unknown = null) {
  const stub = createSupabaseStub(insertError);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

function insertedPost(stub: ReturnType<typeof createSupabaseStub>) {
  return stub.calls.find((call) => call.table === "posts" && call.method === "insert")
    ?.args[0] as Record<string, unknown> | undefined;
}

function photo(name = "foto.jpg"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: "image/jpeg" });
}

/** FormData como la arma el composer. `body` siempre viaja, aunque esté vacío. */
function postForm(input: {
  body: string;
  kind?: "post" | "question" | "text";
  photos?: File[];
  videoPaths?: string[];
}): FormData {
  const data = new FormData();
  data.set("body", input.body);
  data.set("kind", input.kind ?? "post");
  for (const file of input.photos ?? []) data.append("photos", file);
  if (input.videoPaths?.length) {
    data.set("videoPaths", JSON.stringify(input.videoPaths));
    data.set("videoType", "short_video");
    data.set("durationSeconds", "42");
    data.set("videoCategory", "comunidad");
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.moderateText.mockResolvedValue({
    flagged: false,
    categories: [],
    score: 0,
    skipped: false,
  });
  mocks.enqueueModeration.mockResolvedValue({ ok: true });
  mocks.createAdminClient.mockReturnValue({});
  mocks.limit.mockReturnValue({ ok: true });
});

/* ------------------- Cuerpo opcional cuando hay medio --------------------- */

describe("createPostAction — con foto o video el texto es OPCIONAL", () => {
  it("publica una foto SIN una sola letra de texto", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(postForm({ body: "", photos: [photo()] }));

    expect(result).toMatchObject({ ok: true, status: "published" });
    const row = insertedPost(stub);
    expect(row?.body).toBe("");
    expect(row?.kind).toBe("post");
    expect((row?.media as string[]).length).toBe(1);
    expect(stub.uploads.length).toBe(1);
  });

  it("un cuerpo de PUROS ESPACIOS con foto es lo mismo que vacío: publica", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(postForm({ body: "   \n  ", photos: [photo()] }));

    expect(result).toMatchObject({ ok: true });
    // Trimmeado por el esquema: no se persiste el espacio en blanco.
    expect(insertedPost(stub)?.body).toBe("");
  });

  it("publica un VIDEO sin texto (el path propio del prefijo {tenant}/{user})", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(
      postForm({
        body: "",
        videoPaths: [`${TENANT_ID}/${USER_ID}/video-abc.mp4`],
      }),
    );

    expect(result).toMatchObject({ ok: true });
    const row = insertedPost(stub);
    expect(row?.body).toBe("");
    expect(row?.video_type).toBe("short_video");
    expect(row?.duration_seconds).toBe(42);
  });

  it("sigue publicando con texto normal + foto", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(
      postForm({ body: "Se llenó la feria del barrio.", photos: [photo()] }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(insertedPost(stub)?.body).toBe("Se llenó la feria del barrio.");
  });

  it("un cuerpo de UN carácter no pasa ni con foto (es un roce sin querer)", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(postForm({ body: "a", photos: [photo()] }));

    expect(result).toEqual({ ok: false, code: "invalid" });
    // Falla ANTES del guard: no se gasta moderación ni se sube un solo byte.
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
    expect(mocks.moderateText).not.toHaveBeenCalled();
    expect(stub.uploads.length).toBe(0);
  });

  it("el techo de 2000 caracteres sigue en pie", async () => {
    useGuardOk();

    const result = await createPostAction(
      postForm({ body: "x".repeat(2001), photos: [photo()] }),
    );

    expect(result).toEqual({ ok: false, code: "invalid" });
  });
});

/* ---------------------- Sin medio el cuerpo es obligatorio ----------------- */

describe("createPostAction — sin medio no hay publicación vacía", () => {
  it("un texto (kind='text') vacío se rechaza con 'invalid'", async () => {
    useGuardOk();

    const result = await createPostAction(postForm({ body: "", kind: "text" }));

    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("una pregunta (kind='question') vacía se rechaza con 'invalid'", async () => {
    useGuardOk();

    const result = await createPostAction(postForm({ body: "", kind: "question" }));

    expect(result).toEqual({ ok: false, code: "invalid" });
  });

  it("un post sin foto NI texto se rechaza por el medio faltante", async () => {
    useGuardOk();

    // `photo` y no `invalid`: para un kind='post' lo que falta primero es el
    // medio (trigger MEDIA_REQUIRED 0023) — el composer muestra ese aviso.
    const result = await createPostAction(postForm({ body: "", kind: "post" }));

    expect(result).toEqual({ ok: false, code: "photo" });
  });

  it("un texto con cuerpo de verdad sí publica sin medio", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(
      postForm({ body: "Abrió la panadería nueva en la esquina.", kind: "text" }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(insertedPost(stub)?.kind).toBe("text");
    expect(insertedPost(stub)?.media).toEqual([]);
  });
});

/* ------------------------- Cola de moderación ----------------------------- */

describe("createPostAction — una foto sin pie no miente en la cola", () => {
  it("no la encola como 'moderation_skipped': no hubo texto que moderar", async () => {
    useGuardOk();
    // `moderateText("")` corta antes de llamar a nadie y devuelve skipped.
    mocks.moderateText.mockResolvedValue({
      flagged: false,
      categories: [],
      score: 0,
      skipped: true,
    });

    await createPostAction(postForm({ body: "", photos: [photo()] }));

    expect(mocks.enqueueModeration).toHaveBeenCalledTimes(1);
    const payload = mocks.enqueueModeration.mock.calls[0]?.[1] as {
      reasons: string[];
      tier: number;
    };
    // La foto sí necesita ojos (sin Vision): esa es la única razón honesta.
    expect(payload.reasons).toEqual(["photo_async_review"]);
    expect(payload.tier).toBe(3);
  });

  it("si la moderación de un texto REAL falla, sigue marcándose skipped", async () => {
    useGuardOk();
    mocks.moderateText.mockResolvedValue({
      flagged: false,
      categories: [],
      score: 0,
      skipped: true,
    });

    await createPostAction(
      postForm({ body: "Un texto que sí había que moderar.", kind: "text" }),
    );

    const payload = mocks.enqueueModeration.mock.calls[0]?.[1] as { reasons: string[] };
    expect(payload.reasons).toContain("moderation_skipped");
  });
});
