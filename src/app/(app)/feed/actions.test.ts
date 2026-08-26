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
  registerUploadedMedia: vi.fn(),
  notifyPostComment: vi.fn(),
  notifyPostReaction: vi.fn(),
  puedeFirmarComo: vi.fn(),
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

// Content Integrity vive fuera de la frontera que prueba este archivo: acá se
// aísla en su borde (tiene sus propios tests en `src/lib/integrity/`) y por
// default devuelve "todo limpio", que es el escenario contra el que se mide la
// matriz de arriba. Además evita arrastrar `sharp` y `next/headers` al test.
vi.mock("@/lib/integrity", () => ({
  registerUploadedMedia: mocks.registerUploadedMedia,
  normalizeDeclaration: () => ({
    originalityDeclared: false,
    licenseKind: "desconocido",
    licenseStatement: null,
    licenseUrl: null,
  }),
}));
vi.mock("@/lib/integrity/source-host", () => ({
  currentSourceHost: async (fallback: string) => fallback,
}));
/**
 * LA FIRMA DE LA PUBLICACIÓN (`entity_listing_id`, 0023). Se aísla en su borde
 * —tiene sus propios tests en `src/lib/feed/autoria.test.ts`— y acá lo que se
 * prueba es el CABLEADO: que la action pregunte antes de persistir, que un "no"
 * corte la publicación entera, y que sin firma NI SIQUIERA pregunte (un post
 * personal no tiene nada que validar).
 */
vi.mock("@/lib/feed/autoria", () => ({ puedeFirmarComo: mocks.puedeFirmarComo }));
vi.mock("./social-notifications", () => ({
  notifyPostComment: mocks.notifyPostComment,
  notifyPostReaction: mocks.notifyPostReaction,
}));

import { createPostAction } from "./actions";
import {
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  MAX_TOTAL_PHOTO_BYTES,
} from "@/lib/media/post-media-limits";

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
function createSupabaseStub(
  insertError: unknown = null,
  uploadError: unknown = null,
  /**
   * El borrador que devuelve el SELECT de verificación del camino de Mux.
   * `null` = "no existe, o no es tuyo", que es como se prueba el rechazo.
   */
  borradorDeMux: { id: string } | null = null,
) {
  const calls: RecordedCall[] = [];
  const uploads: Array<{ path: string; contentType?: string }> = [];

  const from = vi.fn((table: string) => {
    /**
     * La operación RAÍZ de la cadena. Con el camino de Mux hay tres formas
     * distintas sobre la MISMA tabla —`insert().select().single()`,
     * `select().eq()…maybeSingle()` y `update().eq()…select().maybeSingle()`—
     * y el `.select()` de las dos últimas es el RETURNING del write, no una
     * consulta nueva: sin recordar quién empezó, el stub contestaría lo mismo
     * a las tres y los tests no distinguirían un UPDATE de un INSERT.
     */
    let raiz: "insert" | "update" | "select" | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        raiz ??= "insert";
        return builder;
      }),
      update: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "update", args });
        raiz ??= "update";
        return builder;
      }),
      eq: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        return builder;
      }),
      select: vi.fn(() => {
        raiz ??= "select";
        return builder;
      }),
      single: vi.fn(() =>
        Promise.resolve(
          insertError
            ? { data: null, error: insertError }
            : { data: { id: NEW_POST_ID }, error: null },
        ),
      ),
      maybeSingle: vi.fn(() => {
        // El SELECT de verificación contesta con el borrador (o con nada).
        if (raiz === "select") {
          return Promise.resolve({ data: borradorDeMux, error: null });
        }
        // El UPDATE que publica devuelve la fila tocada, o el error simulado.
        return Promise.resolve(
          insertError
            ? { data: null, error: insertError }
            : { data: { id: borradorDeMux?.id ?? NEW_POST_ID }, error: null },
        );
      }),
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

function useGuardOk(
  insertError: unknown = null,
  borradorDeMux: { id: string } | null = null,
) {
  const stub = createSupabaseStub(insertError, null, borradorDeMux);
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

/** Foto de un peso concreto — para probar los techos, no el contenido. */
function photoOf(bytes: number, name = "pesada.jpg"): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });
}

/** FormData como la arma el composer. `body` siempre viaja, aunque esté vacío. */
function postForm(input: {
  body: string;
  kind?: "post" | "question" | "text";
  photos?: File[];
  videoPaths?: string[];
  /**
   * Lo que el composer manda en `videoFilters`: un arreglo PARALELO a
   * `videoPaths`. Se tipa `unknown` a propósito — la mitad de estas pruebas
   * mandan basura, que es justamente el caso que la action tiene que frenar.
   */
  videoFilters?: unknown;
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
  if (input.videoFilters !== undefined) {
    data.set("videoFilters", JSON.stringify(input.videoFilters));
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
  mocks.registerUploadedMedia.mockResolvedValue({
    needsHumanReview: false,
    reasons: [],
    assetIds: [],
  });
  // Por default la ficha es propia y está publicada: los tests que prueban el
  // rechazo lo invierten. Nunca se deja `undefined` — una promesa sin resolver
  // colgaría la action a mitad de camino y el fallo sería un timeout mudo.
  mocks.puedeFirmarComo.mockResolvedValue(true);
});

/* ------------------- Cupo y peso de las fotos (2026-08-11) ---------------- */

describe("createPostAction — el cupo de fotos es el MISMO que el del composer", () => {
  it("publica las 10 fotos que el composer deja elegir", async () => {
    // EL BUG: el composer subió su tope a 10 y esta action se quedó en 4, así
    // que una publicación normal de 5 fotos rebotaba con `photo` sin que nadie
    // pudiera decir por qué. Ahora el número sale de un solo lugar.
    const stub = useGuardOk();

    const photos = Array.from({ length: MAX_PHOTOS }, (_, index) =>
      photo(`foto-${index}.jpg`),
    );
    const result = await createPostAction(postForm({ body: "", photos }));

    expect(result).toMatchObject({ ok: true, status: "published" });
    expect(stub.uploads.length).toBe(MAX_PHOTOS);
    expect((insertedPost(stub)?.media as string[]).length).toBe(MAX_PHOTOS);
  });

  it("la foto número 11 sí se rechaza", async () => {
    const stub = useGuardOk();

    const photos = Array.from({ length: MAX_PHOTOS + 1 }, (_, index) =>
      photo(`foto-${index}.jpg`),
    );
    const result = await createPostAction(postForm({ body: "", photos }));

    expect(result).toEqual({ ok: false, code: "photo" });
    expect(stub.uploads.length).toBe(0);
  });

  it("respeta el orden elegido con las 10 fotos y el video", async () => {
    // `mediaOrderSchema` tiene su propio techo: si se quedaba en 4+1 mientras
    // el cupo era 10, el orden de una publicación llena se descartaba en
    // silencio y las fotos salían en otro orden del que la persona eligió.
    const stub = useGuardOk();

    const photos = Array.from({ length: MAX_PHOTOS }, (_, index) =>
      photo(`foto-${index}.jpg`),
    );
    const data = postForm({
      body: "",
      photos,
      videoPaths: [`${TENANT_ID}/${USER_ID}/video-abc.mp4`],
    });
    data.set(
      "mediaOrder",
      JSON.stringify(["video", ...Array.from({ length: MAX_PHOTOS }, () => "photo")]),
    );

    const result = await createPostAction(data);

    expect(result).toMatchObject({ ok: true });
    const media = insertedPost(stub)?.media as string[];
    expect(media.length).toBe(MAX_PHOTOS + 1);
    expect(media[0]).toContain("video-abc.mp4");
  });
});

describe("createPostAction — el peso que el servidor acepta entra en el body", () => {
  it("rechaza una foto por encima del techo por archivo", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(
      postForm({ body: "", photos: [photoOf(MAX_PHOTO_BYTES + 1)] }),
    );

    expect(result).toEqual({ ok: false, code: "photo" });
    expect(stub.uploads.length).toBe(0);
  });

  it("rechaza el CONJUNTO aunque cada foto entre sola", async () => {
    // Sin este techo el servidor bendecía payloads que el propio
    // `bodySizeLimit` corta antes de llegar: una validación que aprueba lo
    // imposible no es una validación.
    const stub = useGuardOk();

    const each = Math.floor(MAX_TOTAL_PHOTO_BYTES / MAX_PHOTOS) + 1024;
    const photos = Array.from({ length: MAX_PHOTOS }, (_, index) =>
      photoOf(each, `foto-${index}.jpg`),
    );
    const result = await createPostAction(postForm({ body: "", photos }));

    expect(result).toEqual({ ok: false, code: "photo" });
    expect(stub.uploads.length).toBe(0);
    // Corta ANTES del guard: un payload gigante no gasta ni moderación ni bucket.
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("una publicación de 10 fotos horneadas de verdad sí pasa", async () => {
    const stub = useGuardOk();

    // ~800 KB por foto es el peor caso realista de `bakePhoto` (1600 px, q0.85).
    const photos = Array.from({ length: MAX_PHOTOS }, (_, index) =>
      photoOf(800 * 1024, `foto-${index}.jpg`),
    );
    const result = await createPostAction(postForm({ body: "", photos }));

    expect(result).toMatchObject({ ok: true });
    expect(stub.uploads.length).toBe(MAX_PHOTOS);
  });
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

/* -------- El path del video acepta el mismo catálogo que el composer ------ */

/**
 * EL BUG QUE ESTO CIERRA: `isOwnVideoPath` tenía su propia regex
 * `(mp4|webm)` mientras el composer ya declaraba (o iba a declarar) un
 * `accept` más amplio. El picker dejaba ELEGIR un .mov de iPhone y esta
 * action lo rechazaba recién al publicar, con un `code: "photo"` genérico
 * que no explicaba nada — exactamente el síntoma "no te deja subir cualquier
 * tipo de video" del feedback del cliente. Ahora la regex sale de
 * `VIDEO_FILENAME_PATTERN` (`@/lib/media/video-upload-limits`), el mismo
 * módulo que arma el `accept` del input.
 *
 * EL CATÁLOGO FINAL ES SÓLO mp4/mov/webm (no mkv/avi/mpeg/3gp/3g2: el bucket
 * `post-media` no los permite subir y ningún navegador los reproduce nativo
 * en `<video>` — ver el docblock de `video-upload-limits.ts`). Esta action
 * los sigue rechazando por la misma razón defensa-en-profundidad de siempre:
 * un cliente modificado no puede colar un path con esa extensión.
 */
describe("createPostAction — el path del video acepta el mismo catálogo que el composer", () => {
  it("acepta un .mov (el caso reportado: video grabado en iPhone)", async () => {
    const stub = useGuardOk();
    const path = `${TENANT_ID}/${USER_ID}/video-abc.mov`;

    const result = await createPostAction(postForm({ body: "", videoPaths: [path] }));

    expect(result).toMatchObject({ ok: true });
    expect((insertedPost(stub)?.media as string[])[0]).toBe(path);
  });

  it("acepta un .webm — el resto del catálogo final", async () => {
    const stub = useGuardOk();
    const path = `${TENANT_ID}/${USER_ID}/video-abc.webm`;

    const result = await createPostAction(postForm({ body: "", videoPaths: [path] }));

    expect(result).toMatchObject({ ok: true });
    expect((insertedPost(stub)?.media as string[])[0]).toBe(path);
  });

  it.each(["mkv", "avi", "mpeg", "3gp", "3g2", "exe"])(
    "sigue rechazando .%s — fuera del catálogo a propósito (defensa en profundidad)",
    async (extension) => {
      const stub = useGuardOk();

      const result = await createPostAction(
        postForm({ body: "", videoPaths: [`${TENANT_ID}/${USER_ID}/video-abc.${extension}`] }),
      );

      expect(result).toEqual({ ok: false, code: "photo" });
      expect(insertedPost(stub)).toBeUndefined();
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

/* ------------- Filtro del video como metadato (0104) --------------------- */

/**
 * EL FILTRO DE UN VIDEO NO SE HORNEA: se guarda y se aplica al reproducir. Eso
 * mueve la frontera de confianza — lo que antes era un efecto quemado en un
 * archivo ahora es un dato que viaja del navegador y termina en un `style` que
 * ve TODA la comunidad. Así que acá se prueba lo único que importa de verdad:
 * que del cliente sólo entre lo que existe en el catálogo.
 *
 * La regla es RECHAZAR, no limpiar. Publicar igual sin el filtro le enseñaría a
 * un cliente modificado que puede mandar cualquier cosa mientras el servidor lo
 * tape en silencio.
 */
const VIDEO_PATH = `${TENANT_ID}/${USER_ID}/video-abc.mp4`;

describe("createPostAction — el filtro del video se valida contra el catálogo", () => {
  it("guarda el preset elegido indexado por la RUTA del archivo", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(
      postForm({
        body: "",
        videoPaths: [VIDEO_PATH],
        videoFilters: [{ id: "vintage", intensity: 0.6 }],
      }),
    );

    expect(result.ok).toBe(true);
    expect(insertedPost(stub)?.media_filters).toEqual({
      [VIDEO_PATH]: { id: "vintage", intensity: 0.6 },
    });
  });

  it("RECHAZA un filtro que no existe en el catálogo", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(
      postForm({
        body: "",
        videoPaths: [VIDEO_PATH],
        videoFilters: [{ id: "filtro-inventado", intensity: 1 }],
      }),
    );

    expect(result).toEqual({ ok: false, code: "invalid" });
    // Y no se publicó NADA: el rechazo no puede dejar media a medio guardar.
    expect(insertedPost(stub)).toBeUndefined();
  });

  it("RECHAZA CSS crudo aunque venga con un id válido al lado", async () => {
    // El ataque real que esta validación existe para frenar: un cliente
    // modificado mandando el string de `filter` para que termine en el `style`
    // de todo el que abra la publicación. El campo ni se mira, pero el objeto
    // entero tiene que pasar por el catálogo igual.
    const stub = useGuardOk();

    const result = await createPostAction(
      postForm({
        body: "",
        videoPaths: [VIDEO_PATH],
        videoFilters: [{ id: "url(javascript:alert(1))", css: "blur(40px)" }],
      }),
    );

    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(insertedPost(stub)).toBeUndefined();
  });

  it("RECHAZA una intensidad fuera del rango del control", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(
      postForm({
        body: "",
        videoPaths: [VIDEO_PATH],
        videoFilters: [{ id: "carbon", intensity: 8 }],
      }),
    );

    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(insertedPost(stub)).toBeUndefined();
  });

  it("RECHAZA un arreglo que no cuadra con los videos recibidos", async () => {
    // Sin esta guarda ya no se sabe qué filtro es de qué archivo, y adivinar
    // sería pintarle a alguien un video que no eligió.
    const stub = useGuardOk();

    const result = await createPostAction(
      postForm({
        body: "",
        videoPaths: [VIDEO_PATH],
        videoFilters: [{ id: "calido", intensity: 1 }, { id: "byn", intensity: 1 }],
      }),
    );

    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(insertedPost(stub)).toBeUndefined();
  });

  it("'Original' y la ausencia de filtro se guardan igual: sin nada", async () => {
    const stub = useGuardOk();

    await createPostAction(
      postForm({
        body: "",
        videoPaths: [VIDEO_PATH],
        videoFilters: [{ id: "original", intensity: 1 }],
      }),
    );
    expect(insertedPost(stub)?.media_filters).toEqual({});

    const sinCampo = useGuardOk();
    await createPostAction(postForm({ body: "", videoPaths: [VIDEO_PATH] }));
    expect(insertedPost(sinCampo)?.media_filters).toEqual({});
  });

  it("una publicación de fotos nunca guarda filtros: los suyos van horneados", async () => {
    const stub = useGuardOk();

    await createPostAction(postForm({ body: "", photos: [photo()] }));

    expect(insertedPost(stub)?.media_filters).toEqual({});
  });
});

/* ------- A nombre de quién sale la publicación (entity_listing_id, 0023) --- */

/**
 * ESTA ES LA FRONTERA, no el composer.
 *
 * `entityId` llega por el body de la server action, y el `listings.id` de una
 * ficha es público (está en su propia URL). Persistirlo sin comprobar que la
 * ficha es de quien firma es dejar que cualquiera con un token de la comunidad
 * publique a nombre del negocio de otro. La policy `posts_insert` (0023) ya lo
 * rechazaría; esto corta antes, para no gastar Storage ni la llamada de
 * moderación y para poder devolver un motivo que la UI sepa explicar.
 */
const LISTING_PROPIO = "44444444-4444-4444-8444-444444444444";

function postFormComoEntidad(entityId: string): FormData {
  const data = postForm({ body: "Abrimos también los domingos.", kind: "text" });
  data.set("entityId", entityId);
  return data;
}

describe("createPostAction — publicar COMO una entidad", () => {
  it("con una ficha propia y publicada, el post persiste entity_listing_id", async () => {
    const stub = useGuardOk();
    mocks.puedeFirmarComo.mockResolvedValue(true);

    const result = await createPostAction(postFormComoEntidad(LISTING_PROPIO));

    expect(result).toMatchObject({ ok: true, entity: true });
    expect(insertedPost(stub)?.entity_listing_id).toBe(LISTING_PROPIO);
    // Se preguntó con el tenant y el usuario del GUARD, nunca con lo que vino
    // en el body: el cliente no elige contra quién se lo compara.
    expect(mocks.puedeFirmarComo).toHaveBeenCalledWith(stub.client, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      listingId: LISTING_PROPIO,
    });
  });

  it("una ficha AJENA se rechaza y no se inserta nada", async () => {
    const stub = useGuardOk();
    mocks.puedeFirmarComo.mockResolvedValue(false);

    const result = await createPostAction(
      postFormComoEntidad("55555555-5555-4555-8555-555555555555"),
    );

    expect(result).toEqual({ ok: false, code: "entity" });
    // Ni el INSERT, ni la moderación, ni Storage: se corta antes de gastar nada.
    expect(insertedPost(stub)).toBeUndefined();
    expect(mocks.moderateText).not.toHaveBeenCalled();
    expect(stub.uploads.length).toBe(0);
  });

  it("`entity` es un código PROPIO, no `invalid`: son dos arreglos distintos", async () => {
    useGuardOk();
    mocks.puedeFirmarComo.mockResolvedValue(false);

    const result = await createPostAction(postFormComoEntidad(LISTING_PROPIO));

    // Si esto fuera `invalid`, el composer mostraría "Contanos un poquito más"
    // a alguien cuyo texto está perfecto y cuyo problema es otro.
    expect(result).not.toMatchObject({ code: "invalid" });
  });

  it("un entityId que no es un uuid ni llega a preguntarse: rebota en el esquema", async () => {
    useGuardOk();

    const data = postForm({ body: "Hola comunidad", kind: "text" });
    data.set("entityId", "no-soy-un-uuid");
    const result = await createPostAction(data);

    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.puedeFirmarComo).not.toHaveBeenCalled();
  });

  it("CERO REGRESIÓN: sin entityId el post es personal y no se pregunta nada", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(
      postForm({ body: "Hoy hubo feria en la plaza.", kind: "text" }),
    );

    expect(result).toMatchObject({ ok: true, entity: false });
    expect(insertedPost(stub)?.entity_listing_id).toBeNull();
    expect(mocks.puedeFirmarComo).not.toHaveBeenCalled();
  });
});

/* --------- Publicar un video subido por Mux (borrador → publicado, 0114) --- */

/**
 * ESTA TAMBIÉN ES LA FRONTERA.
 *
 * Con Mux la fila de `posts` YA existe cuando se aprieta Publicar: la creó
 * `/api/mux/subida` en `draft` para poder colgarle la subida. O sea que
 * publicar deja de ser un INSERT y pasa a ser un UPDATE de una fila que ya
 * tiene dueño — y `muxPostDraftId` viaja por el body.
 *
 * Sin comprobar de quién es ese borrador, cualquiera con un token de la
 * comunidad podría quedarse con la publicación de otro, y con el video que esa
 * persona subió. Lo que se fija acá es que las CUATRO condiciones se piden
 * juntas y que, sin ellas, no se escribe nada.
 */
const BORRADOR_MUX = "77777777-7777-4777-8777-777777777777";
const SUBIDA_MUX = "upload-mux-abc123";

function postFormConMux(overrides: { draftId?: string; uploadId?: string } = {}): FormData {
  const data = postForm({ body: "Miren cómo quedó el local.", kind: "text" });
  data.set("muxPostDraftId", overrides.draftId ?? BORRADOR_MUX);
  data.set("muxUploadId", overrides.uploadId ?? SUBIDA_MUX);
  return data;
}

function updatedPost(stub: ReturnType<typeof createSupabaseStub>) {
  return stub.calls.find((call) => call.table === "posts" && call.method === "update")
    ?.args[0] as Record<string, unknown> | undefined;
}

describe("createPostAction — publicar un video de Mux", () => {
  it("con un borrador propio, ACTUALIZA la fila en vez de insertar otra", async () => {
    const stub = useGuardOk(null, { id: BORRADOR_MUX });

    const result = await createPostAction(postFormConMux());

    expect(result).toMatchObject({ ok: true });
    // La clave del cambio: NO nace una publicación nueva. Si esto se rompe,
    // cada video de Mux deja dos filas — el borrador huérfano y la publicación.
    expect(insertedPost(stub)).toBeUndefined();
    expect(updatedPost(stub)).toMatchObject({ status: "published" });
  });

  it("el UPDATE se acota por id, comunidad, autor y estado", async () => {
    const stub = useGuardOk(null, { id: BORRADOR_MUX });

    await createPostAction(postFormConMux());

    // Entre el chequeo de más arriba y este UPDATE corre la moderación, que
    // tarda: el predicado tiene que ir en el WHERE para que "cero filas" sea la
    // respuesta correcta y no una publicación ajena pisada.
    const eqsDelUpdate = stub.calls
      .filter((call) => call.table === "posts" && call.method === "eq")
      .map((call) => call.args[0]);
    for (const columna of ["id", "tenant_id", "author_id", "status"]) {
      expect(eqsDelUpdate).toContain(columna);
    }
  });

  it("un borrador que no es tuyo se rechaza y no escribe nada", async () => {
    // El SELECT de verificación no encuentra fila: no es de este autor, no es
    // de esta comunidad, ya se publicó, o el upload id no corresponde.
    const stub = useGuardOk(null, null);

    const result = await createPostAction(postFormConMux());

    expect(result).toEqual({ ok: false, code: "error" });
    expect(insertedPost(stub)).toBeUndefined();
    expect(updatedPost(stub)).toBeUndefined();
    // Se corta ANTES de gastar la llamada de moderación.
    expect(mocks.moderateText).not.toHaveBeenCalled();
  });

  it("mandar sólo uno de los dos identificadores es inválido", async () => {
    const stub = useGuardOk(null, { id: BORRADOR_MUX });
    const data = postForm({ body: "Sin el par completo.", kind: "text" });
    data.set("muxPostDraftId", BORRADOR_MUX);

    const result = await createPostAction(data);

    // Un cliente que manda medio contrato está roto o probando: no se adivina.
    expect(result).toMatchObject({ ok: false });
    expect(insertedPost(stub)).toBeUndefined();
    expect(updatedPost(stub)).toBeUndefined();
  });

  it("sin Mux el camino de siempre sigue insertando", async () => {
    const stub = useGuardOk();

    const result = await createPostAction(postForm({ body: "Hola.", kind: "text" }));

    expect(result).toMatchObject({ ok: true });
    expect(insertedPost(stub)).toBeDefined();
    expect(updatedPost(stub)).toBeUndefined();
  });
});
