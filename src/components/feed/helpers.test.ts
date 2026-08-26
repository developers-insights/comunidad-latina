import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADVERTISING_VIDEO_MAX_SECONDS,
  PREMIUM_DETAIL_MAX_SECONDS,
  isEligibleForShortFeed,
} from "@/lib/media/video-policy";
import {
  FEED_TABS,
  canPromotePost,
  entityAccentVar,
  entityHref,
  entityKindLabel,
  feedPostVisibilityFilter,
  feedZoneFilter,
  isPaidAdvertising,
  parseTab,
  postMediaUrl,
  postgrestQuoted,
  siguiendoListingVisibilityFilter,
  siguiendoPostVisibilityFilter,
  videoOpensReel,
  viewerPlaybackCapFor,
} from "./helpers";

/**
 * Lógica pura del alcance del feed (feedback cliente 2026-07-19). Node env: el
 * módulo no tiene imports de runtime (solo `import type`), así que se testea
 * directo sin jsdom.
 */

describe("feedPostVisibilityFilter", () => {
  it("sin follows ni promos: solo posts personales (entity null)", () => {
    expect(feedPostVisibilityFilter([], [])).toBe("entity_listing_id.is.null");
  });

  it("con entidades seguidas: personal + esas entidades", () => {
    expect(feedPostVisibilityFilter(["a", "b"], [])).toBe(
      "entity_listing_id.is.null,entity_listing_id.in.(a,b)",
    );
  });

  it("con promociones activas: personal + esos post ids", () => {
    expect(feedPostVisibilityFilter([], ["p1", "p2"])).toBe(
      "entity_listing_id.is.null,id.in.(p1,p2)",
    );
  });

  it("combina las tres fuentes de alcance en un solo grupo OR", () => {
    expect(feedPostVisibilityFilter(["e1"], ["p1"])).toBe(
      "entity_listing_id.is.null,entity_listing_id.in.(e1),id.in.(p1)",
    );
  });

  it("el personal SIEMPRE es la primera condición (nunca se pierde)", () => {
    const parts = feedPostVisibilityFilter(["e1"], ["p1"]).split(",");
    expect(parts[0]).toBe("entity_listing_id.is.null");
  });

  /**
   * El dueño de un negocio no sigue su propia ficha: sin esta rama, su primera
   * publicación comercial no aparecía ni en su propio feed. Misma excepción que
   * `recommendedFeedListingFilter` ya hacía para los avisos.
   */
  it("el viewer siempre ve LO PROPIO, aunque no siga su ficha", () => {
    expect(feedPostVisibilityFilter([], [], "yo")).toBe(
      "entity_listing_id.is.null,author_id.eq.yo",
    );
  });

  it("lo propio convive con seguidos y promocionados en el mismo grupo OR", () => {
    expect(feedPostVisibilityFilter(["e1"], ["p1"], "yo")).toBe(
      "entity_listing_id.is.null,author_id.eq.yo,entity_listing_id.in.(e1),id.in.(p1)",
    );
  });

  it("sin sesión no agrega la rama de autoría (nada que interpolar)", () => {
    expect(feedPostVisibilityFilter(["e1"], [], null)).toBe(
      "entity_listing_id.is.null,entity_listing_id.in.(e1)",
    );
    expect(feedPostVisibilityFilter(["e1"], [], undefined)).toBe(
      "entity_listing_id.is.null,entity_listing_id.in.(e1)",
    );
  });
});

describe("FEED_TABS / parseTab — el tab nuevo (0119)", () => {
  it('"siguiendo" va primero, "para-ti" segundo, después los cuatro verticales', () => {
    expect(FEED_TABS.map((tab) => tab.id)).toEqual([
      "siguiendo",
      "para-ti",
      "propiedades",
      "negocios",
      "profesionales",
      "eventos",
    ]);
  });

  it('parsea "siguiendo" tal cual', () => {
    expect(parseTab("siguiendo")).toBe("siguiendo");
  });

  it("el default SIGUE siendo \"para-ti\" — ningún link viejo cambia de destino", () => {
    expect(parseTab(undefined)).toBe("para-ti");
    expect(parseTab("")).toBe("para-ti");
    expect(parseTab("cualquier-cosa-inventada")).toBe("para-ti");
  });

  it("los otros cinco tabs siguen parseando igual", () => {
    expect(parseTab("para-ti")).toBe("para-ti");
    expect(parseTab("propiedades")).toBe("propiedades");
    expect(parseTab("negocios")).toBe("negocios");
    expect(parseTab("profesionales")).toBe("profesionales");
    expect(parseTab("eventos")).toBe("eventos");
  });
});

/**
 * Alcance del tab "Siguiendo" (0119) — el camino legado (sin RPC). Espeja las
 * tres/dos ramas del `where` de `feed_siguiendo_posts_page` /
 * `feed_siguiendo_listings_page` (supabase/migrations/0119_feed_siguiendo.sql).
 */
describe("siguiendoPostVisibilityFilter", () => {
  it("sin follows: solo lo propio (nunca vacío — 0119 no admite sin sesión)", () => {
    expect(siguiendoPostVisibilityFilter([], [], "yo")).toBe("author_id.eq.yo");
  });

  it("con perfiles seguidos: esos autores + lo propio", () => {
    expect(siguiendoPostVisibilityFilter(["a", "b"], [], "yo")).toBe(
      "author_id.in.(a,b),author_id.eq.yo",
    );
  });

  it("con fichas seguidas: esas entidades + lo propio", () => {
    expect(siguiendoPostVisibilityFilter([], ["e1"], "yo")).toBe(
      "entity_listing_id.in.(e1),author_id.eq.yo",
    );
  });

  it("combina las tres fuentes en un solo grupo OR", () => {
    expect(siguiendoPostVisibilityFilter(["a"], ["e1"], "yo")).toBe(
      "author_id.in.(a),entity_listing_id.in.(e1),author_id.eq.yo",
    );
  });

  /**
   * El dueño de un negocio no sigue su propia ficha: sin esta rama, su
   * primera publicación no aparecería en la ÚNICA pestaña donde está seguro
   * de que tendría que estar. Es la misma excepción que la cuarta rama de
   * `feedPostVisibilityFilter`, y por eso acá NO es opcional (no hay rama
   * "sin viewer" — a "Siguiendo" no se entra sin sesión).
   */
  it("lo propio va SIEMPRE, incluso sin ningún follow", () => {
    const parts = siguiendoPostVisibilityFilter([], [], "yo").split(",");
    expect(parts).toContain("author_id.eq.yo");
  });
});

describe("siguiendoListingVisibilityFilter", () => {
  it("sin follows: null — nada que preguntar (a diferencia de los posts, sin rama propia)", () => {
    expect(siguiendoListingVisibilityFilter([], [])).toBeNull();
  });

  it("con perfiles seguidos: los avisos que publicaron", () => {
    expect(siguiendoListingVisibilityFilter(["a", "b"], [])).toBe(
      "created_by.in.(a,b)",
    );
  });

  it("con fichas seguidas: esos avisos mismos", () => {
    expect(siguiendoListingVisibilityFilter([], ["f1"])).toBe("id.in.(f1)");
  });

  it("combina las dos fuentes en un solo grupo OR", () => {
    expect(siguiendoListingVisibilityFilter(["a"], ["f1"])).toBe(
      "created_by.in.(a),id.in.(f1)",
    );
  });
});

describe("canPromotePost", () => {
  it("el autor puede promocionar su propio post", () => {
    expect(canPromotePost("user-1", "user-1")).toBe(true);
  });

  it("otra persona no puede", () => {
    expect(canPromotePost("user-1", "user-2")).toBe(false);
  });

  it("anónimo (viewer null) no puede", () => {
    expect(canPromotePost("user-1", null)).toBe(false);
  });

  it("post de autor anónimo (author null) no es promocionable", () => {
    expect(canPromotePost(null, null)).toBe(false);
    expect(canPromotePost(null, "user-1")).toBe(false);
  });
});

describe("entityHref", () => {
  it("verticales con detalle por id linkean a su página", () => {
    expect(entityHref("property", "id-1")).toBe("/propiedades/id-1");
    expect(entityHref("professional", "id-1")).toBe("/profesionales/id-1");
    expect(entityHref("event", "id-1")).toBe("/eventos/id-1");
    // Empleos ya tiene sección propia: el aviso del feed abre su detalle.
    expect(entityHref("job", "id-1")).toBe("/empleos/id-1");
  });

  it("negocio linkea a SU perfil, no al directorio entero (call 29/7, 1:05)", () => {
    expect(entityHref("business", "id-1")).toBe("/negocios/id-1");
  });

  it("kind sin página no linkea (nombre sin link antes que link roto)", () => {
    expect(entityHref("desconocido", "id-1")).toBeNull();
  });
});

describe("entityKindLabel / entityAccentVar", () => {
  it("etiqueta legible por vertical, con respaldo", () => {
    expect(entityKindLabel("business")).toBe("Negocio");
    expect(entityKindLabel("event")).toBe("Evento");
    expect(entityKindLabel("otro")).toBe("Comunidad");
  });

  it("acento del módulo por vertical, con respaldo al del feed", () => {
    expect(entityAccentVar("negocios" as string)).toBe("var(--accent-feed)"); // kind desconocido
    expect(entityAccentVar("business")).toBe("var(--accent-negocios)");
    expect(entityAccentVar("event")).toBe("var(--accent-eventos)");
    expect(entityAccentVar("property")).toBe("var(--accent-vivienda)");
    expect(entityAccentVar("job")).toBe("var(--accent-empleos)");
  });
});

describe("postMediaUrl", () => {
  const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = OLD;
  });

  it("path de storage → URL pública del bucket post-media", () => {
    expect(postMediaUrl("tenant/user/post-1.webp")).toBe(
      "https://proj.supabase.co/storage/v1/object/public/post-media/tenant/user/post-1.webp",
    );
  });

  it("URL absoluta (seed/API) se respeta tal cual", () => {
    expect(postMediaUrl("https://cdn.example.com/x.jpg")).toBe(
      "https://cdn.example.com/x.jpg",
    );
  });
});

/**
 * UN VIDEO PUBLICITARIO NO ENTRA AL REEL POR NINGÚN CAMINO.
 *
 * "Ningún camino" son dos, y hay que verificar los dos porque son módulos
 * distintos que podrían separarse:
 *
 *   a) el CONTENIDO del reel — `isEligibleForShortFeed` (video-policy), que es
 *      lo que filtran la query de `/videos` y cada slide antes de pintarse;
 *   b) la ENTRADA al reel — `videoOpensReel` (este módulo), que es lo que decide
 *      qué pasa al TOCAR el video de una tarjeta.
 *
 * Si (a) dice "no entra" y (b) dice "abrí el reel", el resultado es el bug del
 * cliente: te vas de la publicación a un scroll donde el video que tocaste no
 * existe. Este bloque los ancla juntos, a propósito.
 */
describe("el video publicitario se mira DENTRO de su anuncio", () => {
  /** Las filas que la 0046 puede producir para un video de campaña. */
  const AD_ROWS = [
    {
      what: "advertising_video completo (lo que garantiza el constraint)",
      videoType: "advertising_video",
      isPaidAd: true,
      eligibleForShortFeed: false,
      durationSeconds: 480,
    },
    {
      what: "campaña TERMINADA: el tipo y la bandera siguen ahí",
      videoType: "advertising_video",
      isPaidAd: true,
      eligibleForShortFeed: false,
      durationSeconds: 600,
    },
    {
      what: "duración DESCONOCIDA (null no es 'corto')",
      videoType: "advertising_video",
      isPaidAd: true,
      eligibleForShortFeed: false,
      durationSeconds: null,
    },
  ] as const;

  for (const row of AD_ROWS) {
    it(`no es contenido del reel — ${row.what}`, () => {
      expect(
        isEligibleForShortFeed({
          hasVideoMedia: true,
          status: "published",
          videoType: row.videoType,
          isPaidAd: row.isPaidAd,
          eligibleForShortFeed: row.eligibleForShortFeed,
          durationSeconds: row.durationSeconds,
        }),
      ).toBe(false);
    });

    it(`no es entrada al reel — ${row.what}`, () => {
      // En CUALQUIER scope: el del feed general y el de un tab de módulo.
      expect(
        videoOpensReel({ scope: "para-ti", post: { ...row, isPromoted: false } }),
      ).toBe(false);
      expect(
        videoOpensReel({ scope: "eventos", post: { ...row, isPromoted: false } }),
      ).toBe(false);
    });
  }

  it("basta `is_paid_ad` para que no haya reel, aunque el tipo quedara en NULL", () => {
    // Fila defensiva: la base no la produce hoy, pero entre marcar de más y
    // mandar a alguien fuera de un anuncio pago, se marca de más.
    const post = { videoType: null, isPaidAd: true, isPromoted: false };
    expect(isPaidAdvertising(post)).toBe(true);
    expect(videoOpensReel({ scope: "para-ti", post })).toBe(false);
  });

  it("una campaña VIGENTE sobre un post orgánico tampoco abre el reel", () => {
    const post = { videoType: "short_video", isPaidAd: false, isPromoted: true };
    expect(isPaidAdvertising(post)).toBe(true);
    expect(videoOpensReel({ scope: "para-ti", post })).toBe(false);
  });

  it("un corto orgánico SIN campaña sí abre el reel — el veto no es universal", () => {
    const post = { videoType: "short_video", isPaidAd: false, isPromoted: false };
    expect(isPaidAdvertising(post)).toBe(false);
    expect(videoOpensReel({ scope: "para-ti", post })).toBe(true);
    expect(
      isEligibleForShortFeed({
        hasVideoMedia: true,
        status: "published",
        videoType: "short_video",
        isPaidAd: false,
        eligibleForShortFeed: true,
        durationSeconds: 62,
      }),
    ).toBe(true);
  });

  it("el detalle de UNA publicación nunca abre el reel, sea o no publicidad", () => {
    expect(
      videoOpensReel({ scope: "sin-reel", post: { videoType: "short_video" } }),
    ).toBe(false);
  });

  it("el tope de reproducción sale de video-policy, no de un número suelto", () => {
    expect(viewerPlaybackCapFor({ isPaidAd: true })).toBe(ADVERTISING_VIDEO_MAX_SECONDS);
    expect(viewerPlaybackCapFor({ videoType: "advertising_video" })).toBe(
      ADVERTISING_VIDEO_MAX_SECONDS,
    );
    expect(viewerPlaybackCapFor({ videoType: "short_video" })).toBe(
      PREMIUM_DETAIL_MAX_SECONDS,
    );
  });
});

describe("feedZoneFilter (Tu zona en el feed, 0115)", () => {
  it("sin zona elegida devuelve null — que es NO FILTRES, no 'no hay nada'", () => {
    expect(feedZoneFilter([])).toBeNull();
  });

  it("con zona: recorta por area_label", () => {
    expect(feedZoneFilter(["Bronx"])).toBe('area_label.in.("Bronx")');
  });

  it("entrecomilla las etiquetas con coma (PostgREST separa por coma)", () => {
    expect(feedZoneFilter(["Corona, Queens", "Corona"])).toBe(
      'area_label.in.("Corona, Queens","Corona")',
    );
  });

  /**
   * La campaña que compró llegar acá esquiva el recorte; la que compró OTRO
   * barrio no entra en esta lista (la filtra `campanaAlcanzaZona` antes).
   */
  it("suma los posts promocionados que la campaña alcanza", () => {
    expect(feedZoneFilter(["Bronx"], ["p1", "p2"])).toBe(
      'area_label.in.("Bronx"),id.in.(p1,p2)',
    );
  });

  it("sin zona, ni siquiera los promocionados arman un filtro", () => {
    expect(feedZoneFilter([], ["p1"])).toBeNull();
  });
});

describe("postgrestQuoted", () => {
  it("escapa comillas y barras para que el valor no rompa el grupo", () => {
    expect(postgrestQuoted('Barrio "el bajo"')).toBe('"Barrio \\"el bajo\\""');
    expect(postgrestQuoted("a\\b")).toBe('"a\\\\b"');
  });
});
