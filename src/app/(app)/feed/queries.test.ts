import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchActivePromotions,
  fetchBlockedIds,
  fetchFollowedListingIds,
  fetchPostMusic,
  toPostCardModel,
  type PostRow,
} from "./queries";
import type { AuthorView, PostMusicView } from "@/components/feed";

/**
 * Mapeo fila → PostCardModel. Lo que se fija acá es el CONTRATO que consumen las
 * cards (otros módulos compilan contra estos nombres): guardado del viewer,
 * vistas y el WhatsApp de la campaña, además de los defaults honestos cuando el
 * caller no los resuelve. Función pura: sin Supabase, sin jsdom.
 */

const AUTHOR: AuthorView = {
  profileId: "u1",
  displayName: "Ana Gómez",
  avatarUrl: null,
  score: 40,
  level: "confiable",
  signals: [],
};

const NOW = new Date("2026-07-26T12:00:00Z");

function makeRow(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: "post-1",
    body: "hola comunidad",
    kind: "post",
    media: [],
    status: "published",
    like_count: 3,
    comment_count: 2,
    view_count: 128,
    created_at: "2026-07-26T11:00:00Z",
    author_id: "u1",
    entity_listing_id: null,
    // Columnas de video (0046). Una publicación de TEXTO las trae así: sin
    // tipo, sin duración, no paga, y con el veto en su default `true` — que
    // por sí solo no mete nada en el reel (es veto, no afirmación).
    video_type: null,
    duration_seconds: null,
    is_paid_ad: false,
    eligible_for_short_feed: true,
    video_category: null,
    // Las tres marcas del menú ⋯ (0097): una publicación recién nacida no está
    // fijada, ni oculta, ni tiene los comentarios cerrados.
    pinned_at: null,
    hidden_at: null,
    comments_locked_at: null,
    ...overrides,
  };
}

const authors = new Map<string, AuthorView>([["u1", AUTHOR]]);

describe("toPostCardModel", () => {
  it("mapea vistas, guardado y WhatsApp de la campaña", () => {
    const model = toPostCardModel(makeRow(), authors, new Set(["post-1"]), NOW, {
      isPromoted: true,
      savedByViewer: true,
      ctaWhatsapp: "+13055550134",
    });

    expect(model.viewCount).toBe(128);
    expect(model.savedByViewer).toBe(true);
    expect(model.ctaWhatsapp).toBe("+13055550134");
    expect(model.isPromoted).toBe(true);
    expect(model.likedByViewer).toBe(true);
  });

  it("sin extras: nada guardado, sin WhatsApp y sin campaña", () => {
    const model = toPostCardModel(makeRow(), authors, new Set(), NOW);

    expect(model.savedByViewer).toBe(false);
    expect(model.ctaWhatsapp).toBeNull();
    expect(model.isPromoted).toBe(false);
    expect(model.entity).toBeNull();
  });

  it("view_count nulo (fila anterior al backfill de 0038) cae a 0", () => {
    const model = toPostCardModel(makeRow({ view_count: null }), authors, new Set(), NOW);
    expect(model.viewCount).toBe(0);
  });

  it("no rompe lo de siempre: autor, conteos y media resueltos", () => {
    const model = toPostCardModel(
      makeRow({ media: ["t/u/foto.jpg", "t/u/clip.mp4"] }),
      authors,
      new Set(),
      NOW,
    );

    expect(model.author.displayName).toBe("Ana Gómez");
    expect(model.likeCount).toBe(3);
    expect(model.commentCount).toBe(2);
    expect(model.media.map((item) => item.kind)).toEqual(["image", "video"]);
    expect(model.photoUrl).toContain("foto.jpg");
  });

  it("sin extras.music: la publicación no tiene música (null, no undefined)", () => {
    const model = toPostCardModel(makeRow(), authors, new Set(), NOW);
    expect(model.music).toBeNull();
  });

  it("con extras.music: se mapea tal cual (0090)", () => {
    const music: PostMusicView = {
      startSeconds: 12,
      track: {
        id: "track-1",
        title: "Cumbia del barrio",
        artist: "Los del Sur",
        durationSeconds: 180,
        previewUrl: "https://cdn.example.com/track.mp3",
        licenseKind: "cc0",
        attributionRequired: false,
        attributionText: null,
        category: "tropical",
      },
    };
    const model = toPostCardModel(makeRow(), authors, new Set(), NOW, { music });
    expect(model.music).toEqual(music);
  });
});

/* ------------------------------ fetchPostMusic ------------------------------ */

type QueryResult = { data?: unknown; error?: unknown };

/** Builder falso, encadenable y thenable — mismo patrón que post-tags.test.ts. */
function createStub(result: QueryResult) {
  const returnBuilder = () => builder;
  const builder = {
    select: returnBuilder,
    in: returnBuilder,
    then: (resolve: (v: QueryResult) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from };
}

const TRACK_ROW = {
  id: "track-1",
  title: "Cumbia del barrio",
  artist: "Los del Sur",
  duration_seconds: 180,
  storage_path: "global/cumbia.mp3",
  license_kind: "cc_by",
  attribution_required: true,
  attribution_text: "Cumbia del barrio — Los del Sur (CC BY 4.0)",
  category: "tropical",
};

describe("fetchPostMusic", () => {
  it("agrupa por post y embebe la pista ya resuelta", async () => {
    const stub = createStub({
      data: [{ post_id: "post-1", start_seconds: 12, music_tracks: TRACK_ROW }],
    });

    const byPost = await fetchPostMusic(stub.client, ["post-1"]);
    const music = byPost.get("post-1");

    expect(music?.startSeconds).toBe(12);
    expect(music?.track.title).toBe("Cumbia del barrio");
    expect(music?.track.licenseKind).toBe("cc_by");
    expect(music?.track.attributionText).toBe(
      "Cumbia del barrio — Los del Sur (CC BY 4.0)",
    );
  });

  it("sin ids no consulta nada", async () => {
    const stub = createStub({ data: [] });
    expect((await fetchPostMusic(stub.client, [])).size).toBe(0);
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("sin la migración aplicada devuelve vacío en vez de romper el feed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stub = createStub({ error: { code: "42P01" } });
    expect((await fetchPostMusic(stub.client, ["post-1"])).size).toBe(0);
  });

  it("ignora la fila cuya pista se borró a mitad de la lectura", async () => {
    const stub = createStub({
      data: [{ post_id: "post-1", start_seconds: 0, music_tracks: null }],
    });
    expect((await fetchPostMusic(stub.client, ["post-1"])).size).toBe(0);
  });

  it("license_kind/category desconocidos caen al valor más conservador", async () => {
    const stub = createStub({
      data: [
        {
          post_id: "post-1",
          start_seconds: 0,
          music_tracks: { ...TRACK_ROW, license_kind: "algo-nuevo", category: "algo-nuevo" },
        },
      ],
    });
    const music = (await fetchPostMusic(stub.client, ["post-1"])).get("post-1");
    expect(music?.track.licenseKind).toBe("licensed");
    expect(music?.track.category).toBe("general");
  });
});

/* ------------ Insumos del menú ⋯ y filtro de video (0097 / 0104) ---------- */

describe("toPostCardModel — lo que la tarjeta necesita para montar el menú ⋯", () => {
  it("lleva autor, estado, rutas crudas y las tres marcas", () => {
    // Sin esto, el menú en el feed pedía una segunda consulta por publicación —
    // o se montaba a ciegas y ofrecía "Fijar" sobre algo ya fijado.
    const model = toPostCardModel(
      makeRow({
        media: ["t/u/foto.jpg"],
        pinned_at: "2026-07-25T10:00:00Z",
        comments_locked_at: "2026-07-25T11:00:00Z",
      }),
      authors,
      new Set(),
      NOW,
    );

    expect(model.postMenu).toEqual({
      authorId: "u1",
      status: "published",
      // LAS RUTAS, no las URLs públicas: la hoja de edición quita fotos
      // nombrándolas por su ruta en el bucket.
      mediaPaths: ["t/u/foto.jpg"],
      pinnedAt: "2026-07-25T10:00:00Z",
      hiddenAt: null,
      commentsLockedAt: "2026-07-25T11:00:00Z",
    });
  });
});

describe("toPostCardModel — el filtro del video se resuelve contra el catálogo", () => {
  it("le pone a cada medio el CSS que le corresponde POR RUTA", () => {
    const model = toPostCardModel(
      makeRow({
        media: ["t/u/foto.jpg", "t/u/clip.mp4"],
        media_filters: { "t/u/clip.mp4": { id: "byn", intensity: 1 } },
      }),
      authors,
      new Set(),
      NOW,
    );

    expect(model.media[0]?.filterCss).toBeUndefined();
    expect(model.media[1]?.filterCss).toBe("grayscale(1) contrast(1.1)");
  });

  it("un filtro inventado en la fila no llega a la tarjeta", () => {
    // Una fila vieja o tocada a mano puede perder SU filtro; jamás puede meter
    // un texto arbitrario en el `style` de quien abra la publicación.
    const model = toPostCardModel(
      makeRow({
        media: ["t/u/clip.mp4"],
        media_filters: { "t/u/clip.mp4": { id: "blur(40px)", css: "blur(40px)" } },
      }),
      authors,
      new Set(),
      NOW,
    );

    expect(model.media[0]?.filterCss).toBeUndefined();
  });

  it("sin la columna (fila anterior a la 0104) simplemente no hay filtros", () => {
    const model = toPostCardModel(
      makeRow({ media: ["t/u/clip.mp4"] }),
      authors,
      new Set(),
      NOW,
    );

    expect(model.media[0]?.filterCss).toBeUndefined();
  });
});

/**
 * =============================================================================
 * EL VIDEO QUE NO ESTÁ EN EL BUCKET
 * =============================================================================
 *
 * Un video subido por Mux no deja ruta en `posts.media`: el archivo nunca pasó
 * por Storage. Si este mapeo se quedara sólo con las rutas, esa publicación
 * llegaría a la tarjeta SIN NINGÚN MEDIO — pie, y un hueco donde va el video.
 *
 * Este bloque ancla las dos mitades del trato: que la diapositiva se arme, y que
 * armarla no le haya cambiado nada a las publicaciones de siempre.
 */
describe("toPostCardModel — la diapositiva del video de Mux", () => {
  it("arma la diapositiva desde las columnas, sin ninguna ruta en media", () => {
    const model = toPostCardModel(
      makeRow({ media: [], mux_status: "ready", mux_playback_id: "PLAY123" }),
      authors,
      new Set(),
      NOW,
    );

    expect(model.media).toHaveLength(1);
    expect(model.media[0]?.kind).toBe("video");
    expect(model.media[0]?.muxPlaybackId).toBe("PLAY123");
    expect(model.media[0]?.muxStatus).toBe("ready");
  });

  it("su url es la MINIATURA, no un archivo de video que no existe", () => {
    // Cualquier superficie que todavía no sepa de Mux pinta el primer cuadro
    // —feo pero honesto— en vez de un `<video>` con el `src` roto.
    const model = toPostCardModel(
      makeRow({ media: [], mux_status: "ready", mux_playback_id: "PLAY123" }),
      authors,
      new Set(),
      NOW,
    );

    // La URL la arma `muxThumbnailUrl` de `@/lib/mux/urls` — el MISMO módulo que
    // usa el resto de la app. Se afirma acá para que un cambio de formato o de
    // fotograma no se cuele sin que nadie lo mire.
    expect(model.media[0]?.url).toBe(
      "https://image.mux.com/PLAY123/thumbnail.jpg?time=1&width=640&fit_mode=preserve",
    );
  });

  it("un video que todavía se está preparando también tiene diapositiva", () => {
    // Es lo que hace que la publicación exista en el feed apenas se publica, con
    // su estado de "preparando", en vez de aparecer recién cuando Mux termina.
    const model = toPostCardModel(
      makeRow({ media: [], mux_status: "processing", mux_playback_id: null }),
      authors,
      new Set(),
      NOW,
    );

    expect(model.media).toHaveLength(1);
    expect(model.media[0]?.muxStatus).toBe("processing");
    expect(model.media[0]?.url).toBe("");
  });

  it("una fila con basura en mux_status NO genera diapositiva", () => {
    // Mejor una publicación sin video —que es lo que hoy se ve— que una tarjeta
    // con un reproductor que no puede reproducir nada.
    const model = toPostCardModel(
      makeRow({ media: [], mux_status: "vaya-a-saber" }),
      authors,
      new Set(),
      NOW,
    );

    expect(model.media).toHaveLength(0);
  });

  it("con un archivo de video de verdad en media, manda el archivo", () => {
    const model = toPostCardModel(
      makeRow({ media: ["t/u/clip.mp4"], mux_status: "ready", mux_playback_id: "PLAY123" }),
      authors,
      new Set(),
      NOW,
    );

    expect(model.media).toHaveLength(1);
    expect(model.media[0]?.muxPlaybackId).toBeUndefined();
    expect(model.media[0]?.url).toContain("clip.mp4");
  });

  it("las publicaciones de siempre no cambiaron en nada", () => {
    // LA MITAD QUE MÁS IMPORTA: los 36 videos del bucket y todas las fotos.
    const model = toPostCardModel(
      makeRow({ media: ["t/u/foto.jpg", "t/u/clip.mp4"] }),
      authors,
      new Set(),
      NOW,
    );

    expect(model.media).toHaveLength(2);
    expect(model.media.every((item) => item.muxPlaybackId === undefined)).toBe(true);
    expect(model.media.every((item) => item.muxStatus === undefined)).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * Lo que viaja por la URL: topes y fail-closed
 *
 * Las lecturas de supabase-js son GET, así que cada uuid de estas listas
 * termina en el querystring (~39 bytes). Sin tope, el 414 de Kong/nginx no lo
 * dispara un usuario raro: lo dispara el crecimiento del producto, y le pega a
 * todo el tenant a la vez. Estos tests fijan que los topes existan Y que estén
 * ORDENADOS — un `.limit()` sin `.order()` deja que el planificador elija qué
 * 200 sobreviven, que es tan arbitrario como no tener tope.
 * ------------------------------------------------------------------------- */

interface RecordedCall {
  method: string;
  args: unknown[];
}

/** Builder falso que además ANOTA cómo se armó la query (order/limit/eq). */
function createRecordingStub(result: QueryResult) {
  const calls: RecordedCall[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  const builder = {
    select: record("select"),
    eq: record("eq"),
    gt: record("gt"),
    in: record("in"),
    order: record("order"),
    limit: record("limit"),
    then: (resolve: (v: QueryResult) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const from = vi.fn(() => builder);
  const argsOf = (method: string) => calls.filter((c) => c.method === method).map((c) => c.args);
  return { client: { from } as unknown as SupabaseClient, from, calls, argsOf };
}

describe("fetchBlockedIds — filtro de seguridad, no adorno", () => {
  it("si la lectura de bloqueos FALLA, NO devuelve un set vacío: lanza", async () => {
    // El bug que este test existe para que no vuelva: `const { data } = await …`
    // descartaba el error y devolvía `new Set(data ?? [])`, o sea que un hipo de
    // la base se leía como "no bloqueaste a nadie" y quien bloqueó a su acosador
    // volvía a verlo en el feed, en el reel y en los hilos — sin un solo log.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = createRecordingStub({ error: { code: "57014" } });

    await expect(fetchBlockedIds(stub.client, "viewer-1")).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("sin sesión no consulta nada (anónimo no bloqueó a nadie)", async () => {
    const stub = createRecordingStub({ data: [] });
    expect((await fetchBlockedIds(stub.client, null)).size).toBe(0);
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("acota a 200 y se queda con los bloqueos MÁS RECIENTES", async () => {
    const stub = createRecordingStub({ data: [{ blocked_id: "b1" }, { blocked_id: "b2" }] });

    const blocked = await fetchBlockedIds(stub.client, "viewer-1");

    expect([...blocked]).toEqual(["b1", "b2"]);
    expect(stub.argsOf("limit")).toEqual([[200]]);
    expect(stub.argsOf("order")).toEqual([["created_at", { ascending: false }]]);
  });
});

describe("fetchFollowedListingIds — alcance, no seguridad", () => {
  it("acota a 200 por los más recientes", async () => {
    const stub = createRecordingStub({ data: [{ target_id: "l1" }] });

    expect(await fetchFollowedListingIds(stub.client, "viewer-1")).toEqual(["l1"]);
    expect(stub.argsOf("limit")).toEqual([[200]]);
    expect(stub.argsOf("order")).toEqual([["created_at", { ascending: false }]]);
  });

  it("si falla, el feed queda con lo personal + lo promocionado (y se loguea)", async () => {
    // Acá SÍ se degrada en silencio, al revés que con los bloqueos: no ver lo
    // que seguís es ver de menos; no aplicar un bloqueo es mostrar lo que la
    // persona pidió no ver nunca más.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stub = createRecordingStub({ error: { code: "57014" } });

    expect(await fetchFollowedListingIds(stub.client, "viewer-1")).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("fetchActivePromotions — la lista compartida del tenant", () => {
  it("acota a 150 campañas y prioriza las que más tiempo les queda", async () => {
    // Es la lista del TENANT, no la del viewer: cuando cruza el presupuesto de
    // la URL, el feed devuelve 414 para todos a la vez. El orden por `ends_at
    // desc` lo sirve el índice post_promotions_tenant_active_idx.
    const stub = createRecordingStub({
      data: [{ post_id: "p1", cta_whatsapp: " +13055550134 " }, { post_id: "p2" }],
    });

    const promos = await fetchActivePromotions(stub.client, "tenant-1");

    expect([...promos.postIds]).toEqual(["p1", "p2"]);
    expect(promos.whatsappByPostId.get("p1")).toBe("+13055550134");
    expect(stub.argsOf("limit")).toEqual([[150]]);
    expect(stub.argsOf("order")).toEqual([["ends_at", { ascending: false }]]);
  });
});
