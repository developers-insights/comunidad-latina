import { describe, expect, it } from "vitest";
import {
  MAX_SEARCH_LENGTH,
  SEARCH_RESULT_TYPES,
  announceResults,
  countResults,
  groupSearchResults,
  isSearchResultType,
  isSearchable,
  moduleSearchHref,
  resolveSearchMedia,
  sanitizeSearchQuery,
  type RawSearchRow,
} from "./helpers";

function row(overrides: Partial<RawSearchRow> & Pick<RawSearchRow, "result_type" | "id">): RawSearchRow {
  return {
    title: "Título",
    subtitle: null,
    image_url: null,
    href: "/x",
    rank: 0.5,
    ...overrides,
  };
}

describe("sanitizeSearchQuery", () => {
  it("recorta los extremos", () => {
    expect(sanitizeSearchQuery("  cuarto  ")).toBe("cuarto");
  });

  it("colapsa el espacio interno para que el historial no guarde duplicados", () => {
    expect(sanitizeSearchQuery("cuarto   barato")).toBe("cuarto barato");
    expect(sanitizeSearchQuery("cuarto\n\tbarato")).toBe("cuarto barato");
  });

  it("respeta el tope de 80 caracteres de la RPC", () => {
    expect(sanitizeSearchQuery("a".repeat(200))).toHaveLength(MAX_SEARCH_LENGTH);
  });
});

describe("isSearchable", () => {
  it("exige 2 caracteres, igual que la RPC", () => {
    expect(isSearchable("")).toBe(false);
    expect(isSearchable(" a ")).toBe(false);
    expect(isSearchable("ab")).toBe(true);
  });
});

describe("isSearchResultType", () => {
  it("acepta los nueve tipos del contrato y nada más", () => {
    for (const type of SEARCH_RESULT_TYPES) expect(isSearchResultType(type)).toBe(true);
    expect(isSearchResultType("creator_gig")).toBe(false);
    expect(isSearchResultType("")).toBe(false);
  });
});

describe("groupSearchResults", () => {
  it("emite los grupos en el orden de pantalla, no en el que vino la RPC", () => {
    const groups = groupSearchResults([
      row({ result_type: "publicaciones", id: "p1" }),
      row({ result_type: "propiedades", id: "v1" }),
      row({ result_type: "personas", id: "u1" }),
    ]);
    expect(groups.map((group) => group.type)).toEqual([
      "personas",
      "propiedades",
      "publicaciones",
    ]);
  });

  it("conserva el orden DENTRO del grupo (el rank de la RPC) sin re-ordenar", () => {
    const groups = groupSearchResults([
      row({ result_type: "eventos", id: "e1", rank: 0.9 }),
      row({ result_type: "eventos", id: "e2", rank: 0.1 }),
      row({ result_type: "eventos", id: "e3", rank: 0.5 }),
    ]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("no emite grupos vacíos", () => {
    expect(groupSearchResults([])).toEqual([]);
    const groups = groupSearchResults([row({ result_type: "negocios", id: "n1" })]);
    expect(groups).toHaveLength(1);
  });

  it("descarta un result_type desconocido en vez de romper la pantalla", () => {
    const groups = groupSearchResults([
      row({ result_type: "colaboraciones", id: "c1" }),
      row({ result_type: "eventos", id: "e1" }),
    ]);
    expect(groups.map((group) => group.type)).toEqual(["eventos"]);
  });

  it("marca Patrocinado sólo los videos que están en el set de is_paid_ad", () => {
    const groups = groupSearchResults(
      [
        row({ result_type: "videos", id: "vid-pago" }),
        row({ result_type: "videos", id: "vid-organico" }),
        row({ result_type: "publicaciones", id: "vid-pago-post" }),
      ],
      new Set(["vid-pago", "vid-pago-post"]),
    );
    const videos = groups.find((group) => group.type === "videos");
    expect(videos?.items.map((item) => [item.id, item.sponsored])).toEqual([
      ["vid-pago", true],
      ["vid-organico", false],
    ]);
    // Una publicación sin video nunca se marca, aunque su id esté en el set:
    // "Patrocinado" es una marca del video publicitario (§4 del contrato).
    const posts = groups.find((group) => group.type === "publicaciones");
    expect(posts?.items[0].sponsored).toBe(false);
  });

  it("un video patrocinado abre su ANUNCIO, no el scroll de Videos Cortos", () => {
    // `app.video_post_href` (0044) manda todo video a `/videos?start=id`. Ese
    // reel filtra `video_type='short_video'`, así que el patrocinado no está
    // ahí: la persona termina viendo OTROS videos y se fue del anuncio. El
    // destino correcto es el detalle, donde el video se ve dentro del anuncio.
    const groups = groupSearchResults(
      [
        row({ result_type: "videos", id: "vid-pago", href: "/videos?start=vid-pago" }),
        row({ result_type: "videos", id: "vid-organico", href: "/videos?start=vid-organico" }),
      ],
      new Set(["vid-pago"]),
    );
    const videos = groups.find((group) => group.type === "videos");
    expect(videos?.items.map((item) => item.href)).toEqual([
      "/feed/vid-pago",
      "/videos?start=vid-organico",
    ]);
  });
});

describe("countResults", () => {
  it("suma todos los grupos", () => {
    const groups = groupSearchResults([
      row({ result_type: "personas", id: "u1" }),
      row({ result_type: "personas", id: "u2" }),
      row({ result_type: "eventos", id: "e1" }),
    ]);
    expect(countResults(groups)).toBe(3);
  });
});

describe("moduleSearchHref", () => {
  it("arma el link con el parámetro REAL de cada listado", () => {
    expect(moduleSearchHref("propiedades", "cuarto")).toBe("/propiedades?q=cuarto");
    expect(moduleSearchHref("marketplace", "silla")).toBe("/marketplace?q=silla");
    expect(moduleSearchHref("eventos", "fiesta")).toBe("/eventos?q=fiesta");
    expect(moduleSearchHref("negocios", "panadería")).toBe(
      "/negocios?q=panader%C3%ADa",
    );
  });

  it("devuelve null donde el listado NO acepta término (no se ofrece un link que lo descarta)", () => {
    expect(moduleSearchHref("profesionales", "abogado")).toBeNull();
    expect(moduleSearchHref("empleos", "mozo")).toBeNull();
    expect(moduleSearchHref("videos", "receta")).toBeNull();
    expect(moduleSearchHref("publicaciones", "hola")).toBeNull();
  });

  it("devuelve null para personas: no existe un directorio de personas", () => {
    expect(moduleSearchHref("personas", "ana")).toBeNull();
  });

  it("devuelve null si el término queda vacío tras normalizar", () => {
    expect(moduleSearchHref("propiedades", "   ")).toBeNull();
  });
});

describe("resolveSearchMedia", () => {
  it("deja el avatar de una persona tal cual (ya se guarda absoluto)", () => {
    expect(resolveSearchMedia("personas", "https://cdn.example/a.jpg")).toEqual({
      kind: "image",
      url: "https://cdn.example/a.jpg",
    });
  });

  it("resuelve la foto de un aviso contra el bucket listing-photos", () => {
    const media = resolveSearchMedia("propiedades", "tenant/user/foto.jpg");
    expect(media?.kind).toBe("image");
    expect(media?.url).toContain("/storage/v1/object/public/listing-photos/tenant/user/foto.jpg");
  });

  it("respeta una URL absoluta del seed sin prefijarla", () => {
    const media = resolveSearchMedia("eventos", "https://images.example/e.png");
    expect(media?.url).toBe("https://images.example/e.png");
  });

  it("detecta que el medio de un resultado de videos ES un video", () => {
    const media = resolveSearchMedia("videos", "tenant/user/clip.mp4");
    expect(media?.kind).toBe("video");
    expect(media?.url).toContain("/storage/v1/object/public/post-media/tenant/user/clip.mp4");
  });

  it("un post con foto sigue siendo imagen", () => {
    expect(resolveSearchMedia("publicaciones", "tenant/user/foto.webp")?.kind).toBe("image");
  });

  it("sin medio o con cadena vacía devuelve null (la fila usa su ícono de respaldo)", () => {
    expect(resolveSearchMedia("negocios", null)).toBeNull();
    expect(resolveSearchMedia("negocios", "   ")).toBeNull();
  });
});

describe("announceResults", () => {
  it("dice cuántos y de qué tipo", () => {
    const groups = groupSearchResults([
      row({ result_type: "personas", id: "u1" }),
      row({ result_type: "eventos", id: "e1" }),
      row({ result_type: "eventos", id: "e2" }),
    ]);
    expect(announceResults(groups)).toBe("3 resultados: 1 personas, 2 eventos.");
  });

  it("concuerda el singular", () => {
    const groups = groupSearchResults([row({ result_type: "personas", id: "u1" })]);
    expect(announceResults(groups)).toBe("1 resultado: 1 personas.");
  });

  it("no se queda mudo cuando no hay nada", () => {
    expect(announceResults([])).toBe("Sin resultados.");
  });
});
