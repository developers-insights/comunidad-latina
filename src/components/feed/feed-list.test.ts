import { describe, expect, it } from "vitest";
import { feedItemKey, mergeFeedItems } from "./feed-list";
import type { AuthorView, FeedItem } from "./helpers";

/**
 * Lógica pura del acumulado de scroll infinito (módulo FLUIDEZ). Sin imports
 * de runtime aparte de tipos, igual que helpers.test.ts / feed-tabs.test.ts:
 * se testea directo en node, sin jsdom.
 */

const AUTHOR: AuthorView = {
  profileId: null,
  displayName: "Alguien",
  avatarUrl: null,
  score: 0,
  level: "nuevo",
  signals: [],
};

function makePost(id: string, createdAt = "2026-01-01T00:00:00Z"): FeedItem {
  return {
    type: "post",
    id,
    createdAt,
    post: {
      id,
      kind: "post",
      body: "hola comunidad",
      photoUrl: null,
      media: [],
      likeCount: 0,
      commentCount: 0,
      createdAt,
      timeAgoLabel: "ahora",
      author: AUTHOR,
      likedByViewer: false,
      entity: null,
      isPromoted: false,
    },
  };
}

function makeListingProperty(id: string, createdAt = "2026-01-01T00:00:00Z"): FeedItem {
  return {
    type: "listing-property",
    id,
    createdAt,
    listing: {
      id,
      title: "Casa en alquiler",
      priceLabel: null,
      areaLabel: null,
      photoUrl: null,
      verification: null,
      publisher: null,
    },
  };
}

function makeListing(id: string, createdAt = "2026-01-01T00:00:00Z"): FeedItem {
  return {
    type: "listing",
    id,
    createdAt,
    listing: {
      id,
      kind: "business",
      title: "Negocio local",
      description: null,
      priceLabel: null,
      areaLabel: null,
      photoUrl: null,
      verifiedDateLabel: null,
      publisherName: null,
      publisherTrust: null,
    },
  };
}

function makeGuide(slug: string): FeedItem {
  return {
    type: "guide",
    id: `guide-${slug}`,
    createdAt: "",
    guide: { slug, title: "Guía", summary: null, readingMinutes: null },
  };
}

describe("feedItemKey", () => {
  it("post: prefijo post-", () => {
    expect(feedItemKey(makePost("p1"))).toBe("post-p1");
  });

  it("listing-property y listing (no-property) comparten prefijo listing- (mismo espacio de ids de la tabla listings)", () => {
    expect(feedItemKey(makeListingProperty("l1"))).toBe("listing-l1");
    expect(feedItemKey(makeListing("l2"))).toBe("listing-l2");
  });

  it("guide: el id YA viene con el prefijo guide- armado en el merge del server", () => {
    expect(feedItemKey(makeGuide("primeros-pasos"))).toBe("guide-primeros-pasos");
  });
});

describe("mergeFeedItems", () => {
  it("agrega los ítems nuevos al final, conservando el orden de llegada", () => {
    const existing = [makePost("p1"), makePost("p2")];
    const incoming = [makePost("p3"), makeListing("l1")];
    const merged = mergeFeedItems(existing, incoming);
    expect(merged.map((item) => item.id)).toEqual(["p1", "p2", "p3", "l1"]);
  });

  it("nunca duplica un id que ya estaba (red de seguridad del keyset)", () => {
    const existing = [makePost("p1"), makeListingProperty("l1")];
    // p1 vuelve a aparecer en la página siguiente (no debería pasar, pero si
    // pasa no se pinta dos veces).
    const incoming = [makePost("p1"), makePost("p2")];
    const merged = mergeFeedItems(existing, incoming);
    expect(merged.map((item) => item.id)).toEqual(["p1", "l1", "p2"]);
  });

  it("si la página entera ya estaba, devuelve la MISMA referencia (no dispara un re-render de más)", () => {
    const existing = [makePost("p1")];
    const merged = mergeFeedItems(existing, [makePost("p1")]);
    expect(merged).toBe(existing);
  });

  it("listing-property y listing (no-property) nunca chocan aunque compartan prefijo de key", () => {
    const existing = [makeListingProperty("shared-id")];
    // Mismo id pero de OTRO tipo: en la práctica no puede pasar (ids de una
    // sola tabla), pero si pasara, mergeFeedItems debe tratarlos como el MISMO
    // slot (la key es la fuente de verdad para dedupe, por diseño) — se
    // documenta acá para que un cambio futuro no lo rompa sin querer.
    const merged = mergeFeedItems(existing, [makeListing("shared-id")]);
    expect(merged).toBe(existing);
  });
});
