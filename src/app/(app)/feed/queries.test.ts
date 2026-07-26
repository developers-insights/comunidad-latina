import { describe, expect, it } from "vitest";
import { toPostCardModel, type PostRow } from "./queries";
import type { AuthorView } from "@/components/feed";

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
});
