import { describe, expect, it } from "vitest";
import { feedItemKey, mergeFeedItems, renderFeedItem } from "./feed-list";
import type { AuthorView, FeedItem, FeedTabId } from "./helpers";

/**
 * Lógica pura del acumulado de scroll infinito (módulo FLUIDEZ) + el cableado
 * de props de `renderFeedItem`. Sin jsdom: crear un elemento de React no lo
 * renderiza, así que alcanza con leer sus props — igual que helpers.test.ts /
 * feed-tabs.test.ts, que corren directo en node.
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
      savedByViewer: false,
      poll: null,
      viewCount: 0,
      entity: null,
      isPromoted: false,
      ctaWhatsapp: null,
      taggedPeople: [],
      music: null,
      postMenu: {
        authorId: null,
        status: "published",
        mediaPaths: [],
        pinnedAt: null,
        hiddenAt: null,
        commentsLockedAt: null,
      },
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

describe("renderFeedItem: el tab viaja como videoScope", () => {
  /** Props del elemento creado (no se renderiza: alcanza con inspeccionarlo). */
  function propsOf(item: FeedItem, tab: FeedTabId): Record<string, unknown> {
    const element = renderFeedItem(item, "tenant-1", "viewer-1", tab);
    return (element as { props: Record<string, unknown> }).props;
  }

  it("pasa el tab activo a la PostCard (tocar un video abre el reel de ESE módulo)", () => {
    expect(propsOf(makePost("p1"), "negocios").videoScope).toBe("negocios");
    expect(propsOf(makePost("p2"), "eventos").videoScope).toBe("eventos");
  });

  it('en "Para ti" el scope es "para-ti" (el reel muestra todo)', () => {
    expect(propsOf(makePost("p1"), "para-ti").videoScope).toBe("para-ti");
  });

  it("cada id de FEED_TABS es un scope válido del reel (contrato 1:1 con VIDEO_SCOPES)", () => {
    // Si alguien agrega un tab al feed sin su scope en videos/helpers.ts, el
    // tap sobre un video abriría un reel vacío. Este test lo fija de este lado.
    const tabs: FeedTabId[] = [
      "para-ti",
      "propiedades",
      "negocios",
      "profesionales",
      "eventos",
    ];
    for (const tab of tabs) {
      expect(propsOf(makePost(`p-${tab}`), tab).videoScope).toBe(tab);
    }
  });

  it("los ítems que no son post no reciben scope (no hay video que abrir)", () => {
    expect(propsOf(makeListing("l1"), "negocios").videoScope).toBeUndefined();
    expect(propsOf(makeGuide("primeros-pasos"), "negocios").videoScope).toBeUndefined();
  });
});
