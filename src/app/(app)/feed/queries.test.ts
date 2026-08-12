import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPostMusic, toPostCardModel, type PostRow } from "./queries";
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
