import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * EL VIDEO LARGO DE UNA CAMPAÑA — quién puede, cuánto, y qué queda escrito
 * =============================================================================
 *
 * Esta action es la ÚNICA puerta por la que una publicación puede pasar de 90
 * segundos, así que estos tests fijan las tres cosas que la sostienen:
 *
 *  1. SIN CAMPAÑA ACTIVA NO HAY VIDEO LARGO. Es la regla que dijo el cliente
 *     («solamente el que paga la publicidad»), y la que hace que el chip
 *     "Patrocinado" signifique algo. El trigger de la base se conforma con que
 *     exista una fila de campaña de cualquier estado: si esta action se
 *     conformara con lo mismo, empezar un Checkout y abandonarlo alcanzaría.
 *  2. EL TOPE ES EL DEL TIPO, y se re-valida en el servidor. Un cliente
 *     modificado que declare una hora no publica.
 *  3. LAS CUATRO COLUMNAS DE LA 0046 VAN JUNTAS. Si el UPDATE olvidara una,
 *     el CHECK `posts_advertising_video_rules` lo rebotaría en producción — y
 *     un test que sólo mire `video_type` no lo notaría hasta el deploy.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  createAdminClient: vi.fn(),
  limit: vi.fn(() => ({ ok: true })),
  // Los parámetros están tipados —aunque no se usen— porque los tests LEEN
  // `mock.calls[0][n]`: sin firma, TypeScript infiere una tupla vacía y el
  // índice no existe.
  registerUploadedMedia: vi.fn(async (_input: unknown) => ({
    needsHumanReview: false,
    reasons: [] as string[],
    assetIds: [] as string[],
  })),
  enqueueModeration: vi.fn(async (_admin: unknown, _args: unknown) => ({ ok: true })),
  currentSourceHost: vi.fn(async () => "comunidadlatina.test"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
vi.mock("@/lib/config/services", () => ({ isVisionConfigured: false }));
vi.mock("@/lib/integrity", () => ({
  registerUploadedMedia: mocks.registerUploadedMedia,
}));
vi.mock("@/lib/integrity/source-host", () => ({
  currentSourceHost: mocks.currentSourceHost,
}));
vi.mock("@/lib/moderation", () => ({
  enqueueModeration: mocks.enqueueModeration,
  TIER_HUMAN: 3,
}));

import {
  ADVERTISING_VIDEO_MAX_SECONDS,
  SHORT_VIDEO_MAX_SECONDS,
  isEligibleForShortFeed,
  isLongVideo,
} from "@/lib/media/video-policy";
import {
  MAX_VIDEO_BYTES,
  formatVideoTooBigMessage,
} from "@/lib/media/video-upload-limits";
import { adjuntarVideoPublicitario } from "./video-publicitario";

const TENANT = "019fa477-58e6-7ab9-ae4f-cc41716f6410";
const USER = "019fa477-58e6-7ab9-ae4f-cc41716f6420";
const OTRO_USER = "019fa477-58e6-7ab9-ae4f-cc41716f6421";
const POST = "019fa477-58e6-7ab9-ae4f-cc41716f6430";

const VIDEO = `${TENANT}/${USER}/video-largo.mp4`;
const POSTER = `${TENANT}/${USER}/poster-largo.jpg`;
const FOTO = `${TENANT}/${USER}/post-1.jpg`;
const VIDEO_VIEJO = `${TENANT}/${USER}/video-corto.mp4`;

interface Escenario {
  /** Fila de `posts` que devuelve la RLS del usuario. null = no existe para él. */
  post?: Record<string, unknown> | null;
  /** ¿Hay campaña activa y vigente? */
  campanaActiva?: boolean;
  /** Peso REAL del objeto en el bucket. null = el objeto no está (0135). */
  bytes?: number | null;
}

/** Cliente del USUARIO: sólo lee (ownership y campaña). */
function userSupabase({ post = {}, campanaActiva = true }: Escenario) {
  const fila =
    post === null
      ? null
      : {
          id: POST,
          tenant_id: TENANT,
          author_id: USER,
          status: "published",
          media: [FOTO, VIDEO_VIEJO],
          mux_status: null,
          ...post,
        };
  return {
    from(table: string) {
      if (table === "post_promotions") {
        const promo = {
          select: () => promo,
          eq: () => promo,
          gt: () => promo,
          limit: () => promo,
          maybeSingle: async () => ({
            data: campanaActiva ? { id: "promo-1" } : null,
            error: null,
          }),
        };
        return promo;
      }
      const posts = {
        select: () => posts,
        eq: () => posts,
        maybeSingle: async () => ({ data: fila, error: null }),
      };
      return posts;
    },
  };
}

/**
 * Cliente ADMIN: anota el UPDATE que se intentó sobre `posts` y contesta el
 * `storage.list` con el que la action mide el peso del objeto ya subido (0135).
 *
 * `bytes: null` = el objeto NO ESTÁ en el bucket, que es un caso propio: la
 * ruta la manda el cliente y nada garantiza que haya subido algo ahí.
 */
function adminSupabase(bytes: number | null = 1024) {
  const updates: Record<string, unknown>[] = [];
  const listCalls: { carpeta: string; options: unknown }[] = [];
  const client = {
    from() {
      const builder = {
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return builder;
        },
        eq: () => builder,
        select: async () => ({ data: [{ id: POST }], error: null }),
      };
      return builder;
    },
    storage: {
      from: () => ({
        list: async (carpeta: string, options: unknown) => {
          listCalls.push({ carpeta, options });
          return {
            data:
              bytes === null
                ? []
                : [{ name: "video-largo.mp4", metadata: { size: bytes } }],
            error: null,
          };
        },
      }),
    },
  };
  return { client, updates, listCalls };
}

function setup(escenario: Escenario = {}) {
  const admin = adminSupabase(escenario.bytes);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT, slug: "dominicanos" },
    supabase: userSupabase(escenario),
    user: { id: USER },
  });
  mocks.createAdminClient.mockReturnValue(admin.client);
  return admin;
}

const ENTRADA = {
  postId: POST,
  videoPath: VIDEO,
  posterPath: POSTER,
  durationSeconds: 300,
  videoCategory: "propiedades" as const,
  videoFrames: null,
  audioPcm: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
  mocks.registerUploadedMedia.mockResolvedValue({
    needsHumanReview: false,
    reasons: [],
    assetIds: [],
  });
  mocks.enqueueModeration.mockResolvedValue({ ok: true });
});

describe("el derecho a subir un video largo", () => {
  it("SIN campaña activa no se adjunta nada", async () => {
    const admin = setup({ campanaActiva: false });
    const result = await adjuntarVideoPublicitario(ENTRADA);
    expect(result.status).toBe("sin_campana");
    // Lo que importa no es el mensaje: es que la base no se tocó.
    expect(admin.updates).toHaveLength(0);
  });

  it("CON campaña activa, un video de 5 minutos se guarda", async () => {
    setup();
    const result = await adjuntarVideoPublicitario(ENTRADA);
    expect(result.status).toBe("ok");
  });

  it("una publicación ajena se rechaza sin escribir", async () => {
    const admin = setup({ post: { author_id: OTRO_USER } });
    const result = await adjuntarVideoPublicitario(ENTRADA);
    expect(result.status).toBe("error");
    expect(admin.updates).toHaveLength(0);
  });

  it("una publicación que todavía no está en línea se rechaza", async () => {
    const admin = setup({ post: { status: "pending_review" } });
    expect((await adjuntarVideoPublicitario(ENTRADA)).status).toBe("error");
    expect(admin.updates).toHaveLength(0);
  });

  it("una ruta del prefijo de OTRA persona no llega ni a leer la publicación", async () => {
    const admin = setup();
    const result = await adjuntarVideoPublicitario({
      ...ENTRADA,
      videoPath: `${TENANT}/${OTRO_USER}/video-robado.mp4`,
    });
    expect(result.status).toBe("error");
    expect(admin.updates).toHaveLength(0);
  });

  it("un poster del prefijo ajeno tampoco pasa", async () => {
    const admin = setup();
    const result = await adjuntarVideoPublicitario({
      ...ENTRADA,
      posterPath: `${TENANT}/${OTRO_USER}/poster.jpg`,
    });
    expect(result.status).toBe("error");
    expect(admin.updates).toHaveLength(0);
  });
});

describe("el tope de duración, del lado del servidor", () => {
  it(`acepta justo el tope publicitario (${ADVERTISING_VIDEO_MAX_SECONDS} s)`, async () => {
    const admin = setup();
    const result = await adjuntarVideoPublicitario({
      ...ENTRADA,
      durationSeconds: ADVERTISING_VIDEO_MAX_SECONDS,
    });
    expect(result.status).toBe("ok");
    expect(admin.updates[0].duration_seconds).toBe(ADVERTISING_VIDEO_MAX_SECONDS);
  });

  it("rechaza un segundo más que el tope, aunque el navegador lo haya dejado pasar", async () => {
    const admin = setup();
    const result = await adjuntarVideoPublicitario({
      ...ENTRADA,
      durationSeconds: ADVERTISING_VIDEO_MAX_SECONDS + 1,
    });
    expect(result.status).toBe("error");
    expect(admin.updates).toHaveLength(0);
  });

  it("una duración DESCONOCIDA no es 'corta': se rechaza", async () => {
    const admin = setup();
    for (const durationSeconds of [0, -3, Number.NaN, "hola"]) {
      const result = await adjuntarVideoPublicitario({ ...ENTRADA, durationSeconds });
      expect(result.status).toBe("error");
    }
    expect(admin.updates).toHaveLength(0);
  });

  it("redondea HACIA ARRIBA — declarar 300,4 no compra medio segundo gratis", async () => {
    const admin = setup();
    await adjuntarVideoPublicitario({ ...ENTRADA, durationSeconds: 300.4 });
    expect(admin.updates[0].duration_seconds).toBe(301);
  });

  it(`un video que un corto podría llevar (${SHORT_VIDEO_MAX_SECONDS} s) también entra`, async () => {
    // No hay piso: la campaña puede querer un video breve, y obligar a que dure
    // más de 90 s sería inventar una regla que nadie pidió.
    const admin = setup();
    const result = await adjuntarVideoPublicitario({
      ...ENTRADA,
      durationSeconds: SHORT_VIDEO_MAX_SECONDS,
    });
    expect(result.status).toBe("ok");
    expect(admin.updates[0].video_type).toBe("advertising_video");
  });
});

describe("lo que queda escrito en la fila", () => {
  it("las cuatro columnas de la 0046 van JUNTAS", async () => {
    const admin = setup();
    await adjuntarVideoPublicitario(ENTRADA);
    expect(admin.updates[0]).toMatchObject({
      video_type: "advertising_video",
      duration_seconds: 300,
      is_paid_ad: true,
      // El veto que lo saca del scroll de Videos Cortos. Sin esto el CHECK
      // `posts_advertising_video_rules` rebota, y con razón.
      eligible_for_short_feed: false,
    });
  });

  it("el video nuevo reemplaza al viejo y las fotos se quedan", async () => {
    const admin = setup();
    await adjuntarVideoPublicitario(ENTRADA);
    expect(admin.updates[0].media).toEqual([FOTO, VIDEO]);
  });

  it("guarda la categoría elegida y el poster", async () => {
    const admin = setup();
    await adjuntarVideoPublicitario(ENTRADA);
    expect(admin.updates[0].video_category).toBe("propiedades");
    expect(admin.updates[0].video_poster_path).toBe(POSTER);
  });

  it("sin poster la columna queda en NULL, y no con el del video anterior", async () => {
    const admin = setup();
    await adjuntarVideoPublicitario({ ...ENTRADA, posterPath: null });
    expect(admin.updates[0].video_poster_path).toBeNull();
  });

  it("sin categoría elegida cae al default del catálogo", async () => {
    const admin = setup();
    await adjuntarVideoPublicitario({ ...ENTRADA, videoCategory: undefined });
    expect(admin.updates[0].video_category).toBe("otros");
  });
});

describe("las guardas que no son de video", () => {
  it("el techo horario corta antes de escribir", async () => {
    const admin = setup();
    mocks.limit.mockReturnValue({ ok: false });
    const result = await adjuntarVideoPublicitario(ENTRADA);
    expect(result.status).toBe("error");
    expect(admin.updates).toHaveLength(0);
  });

  it("sin sesión se pide entrar, no se muestra un error genérico", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
    });
    expect((await adjuntarVideoPublicitario(ENTRADA)).status).toBe("sin_sesion");
  });

  it("una publicación con video de Mux no acepta un segundo video del bucket", async () => {
    const admin = setup({ post: { mux_status: "ready" } });
    expect((await adjuntarVideoPublicitario(ENTRADA)).status).toBe("error");
    expect(admin.updates).toHaveLength(0);
  });
});

describe("el video pago pasa por el mismo pipeline que los demás", () => {
  it("deja la huella del archivo con la ruta y el bucket reales", async () => {
    setup();
    await adjuntarVideoPublicitario(ENTRADA);
    expect(mocks.registerUploadedMedia).toHaveBeenCalledTimes(1);
    const args = mocks.registerUploadedMedia.mock.calls[0][0] as unknown as {
      items: Array<{ mediaKind: string; storagePath: string; storageBucket: string }>;
      subjectId: string;
    };
    expect(args.subjectId).toBe(POST);
    expect(args.items[0]).toMatchObject({
      mediaKind: "video",
      storageBucket: "post-media",
      storagePath: VIDEO,
    });
  });

  it("sin Vision configurado el video va a la cola humana", async () => {
    setup();
    await adjuntarVideoPublicitario(ENTRADA);
    expect(mocks.enqueueModeration).toHaveBeenCalledTimes(1);
    const args = mocks.enqueueModeration.mock.calls[0][1] as unknown as {
      reasons: string[];
    };
    expect(args.reasons).toContain("video_async_review");
  });

  it("si la revisión falla, el video igual queda publicado", async () => {
    setup();
    mocks.registerUploadedMedia.mockRejectedValue(new Error("integrity caída"));
    const result = await adjuntarVideoPublicitario(ENTRADA);
    expect(result.status).toBe("ok");
  });
});

describe("la fila que esta action escribe, mirada por las superficies", () => {
  /**
   * EL TEST QUE CIERRA EL CÍRCULO.
   *
   * Los demás miran el payload campo por campo; éste se lo da a las dos
   * funciones que deciden DÓNDE se ve un video y comprueba el resultado. Es la
   * diferencia entre "el UPDATE escribió `eligible_for_short_feed: false`" y "un
   * video pago de cinco minutos no puede aparecer en el scroll de Videos
   * Cortos", que es lo que de verdad se prometió.
   */
  async function filaEscrita(durationSeconds: number) {
    const admin = setup();
    await adjuntarVideoPublicitario({ ...ENTRADA, durationSeconds });
    return admin.updates[0] as {
      video_type: string;
      duration_seconds: number;
      is_paid_ad: boolean;
      eligible_for_short_feed: boolean;
    };
  }

  it("NUNCA entra al scroll de Videos Cortos", async () => {
    const fila = await filaEscrita(300);
    expect(
      isEligibleForShortFeed({
        videoType: fila.video_type,
        durationSeconds: fila.duration_seconds,
        isPaidAd: fila.is_paid_ad,
        eligibleForShortFeed: fila.eligible_for_short_feed,
        status: "published",
        hasVideoMedia: true,
      }),
    ).toBe(false);
  });

  it("SÍ es un video largo — que es lo que lista /videos/largos", async () => {
    const fila = await filaEscrita(300);
    expect(
      isLongVideo({
        videoType: fila.video_type,
        durationSeconds: fila.duration_seconds,
      }),
    ).toBe(true);
  });

  it("y sigue siendo largo aunque el archivo dure menos que un corto", async () => {
    // `advertising_video` es largo por CONTRATO: es el tipo que la sección
    // promete. Si esto fuera false, un video de campaña breve se subiría bien y
    // después no aparecería en ninguna de las dos pantallas.
    const fila = await filaEscrita(SHORT_VIDEO_MAX_SECONDS - 30);
    expect(
      isLongVideo({
        videoType: fila.video_type,
        durationSeconds: fila.duration_seconds,
      }),
    ).toBe(true);
  });
});

describe("el tope de PESO, del lado del servidor (H-4, 0135)", () => {
  /**
   * Esta action no recibe el archivo: recibe la RUTA de algo que el navegador
   * ya subió directo al bucket. Hasta la 0135, el tope de 200 MB vivía entero
   * en el JavaScript que hace esa subida —saltearlo era escribir un `fetch` a
   * mano— y el bucket estaba en 250 MB, así que los 50 MB de margen que la 0132
   * había dejado a propósito para el composer eran, en esta ruta, 50 MB de nada.
   */
  it("un archivo dentro del tope se publica", async () => {
    const admin = setup({ bytes: MAX_VIDEO_BYTES });
    const result = await adjuntarVideoPublicitario(ENTRADA);
    expect(result.status).toBe("ok");
    expect(admin.updates).toHaveLength(1);
  });

  it("un byte más que el tope NO se publica, aunque ya esté subido", async () => {
    const admin = setup({ bytes: MAX_VIDEO_BYTES + 1 });
    const result = await adjuntarVideoPublicitario(ENTRADA);
    expect(result.status).toBe("error");
    expect(admin.updates).toHaveLength(0);
  });

  it("el rechazo dice el peso real y el máximo, no un error genérico", async () => {
    setup({ bytes: 250 * 1024 * 1024 });
    const result = await adjuntarVideoPublicitario(ENTRADA);
    // El molde del mensaje lo escribe `video-upload-limits.ts`, que es el módulo
    // que conoce los números: acá se comprueba que sea EL MISMO que ve la
    // persona en el composer, y no una frase nueva escrita a mano.
    expect(result).toMatchObject({
      status: "error",
      message: formatVideoTooBigMessage(250 * 1024 * 1024),
    });
  });

  it("una ruta que NO existe en el bucket tampoco se cuelga de la publicación", async () => {
    // Sin esto, alguien podía apuntar su publicación a un archivo inventado de
    // su propia carpeta y dejar la tarjeta con un video roto para todos.
    const admin = setup({ bytes: null });
    const result = await adjuntarVideoPublicitario(ENTRADA);
    expect(result.status).toBe("error");
    expect(admin.updates).toHaveLength(0);
  });

  it("se mide el archivo de ESTA publicación, buscándolo en su propia carpeta", async () => {
    const admin = setup();
    await adjuntarVideoPublicitario(ENTRADA);
    expect(admin.listCalls).toHaveLength(1);
    expect(admin.listCalls[0].carpeta).toBe(`${TENANT}/${USER}`);
    // `search` es un LIKE: por eso la action además compara el nombre exacto.
    expect(admin.listCalls[0].options).toMatchObject({ search: "video-largo.mp4" });
  });

  it("el peso se mide DESPUÉS de la campaña: sin campaña ni se consulta el bucket", async () => {
    const admin = setup({ campanaActiva: false });
    const result = await adjuntarVideoPublicitario(ENTRADA);
    expect(result.status).toBe("sin_campana");
    expect(admin.listCalls).toHaveLength(0);
  });

  it("el número es el mismo que la 0135 le puso al bucket", () => {
    // Si alguien cambia uno y no el otro, Storage y la app dejan de decir lo
    // mismo y vuelve a haber una ruta por la que se cuela un archivo grande.
    const sql = readFileSync(
      new URL(
        "../../../../../supabase/migrations/0135_grupos_moderables_y_cierres.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain(`set file_size_limit = ${MAX_VIDEO_BYTES}`);
  });
});
