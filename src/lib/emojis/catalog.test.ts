import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMMUNITY_EMOJI_CATEGORIES,
  MAX_EMOJIS_IN_TEXT,
  communityEmojiUrl,
  emojiShortcode,
  filterEmojis,
  groupByCategory,
  indexBySlug,
  parseEmojiText,
  resolveCommunityEmojiCategory,
  toCommunityEmoji,
  type CommunityEmoji,
  type CommunityEmojiRow,
} from "./catalog";

/**
 * El contrato del catálogo de emojis propios (0125).
 *
 * Se testea acá y no en la UI porque son las cuentas que TRES superficies dan
 * por sentadas: el picker, el horneado de la foto y el renderer del comentario.
 * Si `parseEmojiText` se equivoca, el error no se ve como un bug — se ve como
 * un comentario que dice ":klk:".
 */

function row(over: Partial<CommunityEmojiRow> = {}): CommunityEmojiRow {
  return {
    id: "e-1",
    tenant_id: null,
    slug: "klk",
    label: "KLK",
    alt_text: "Saludo con la mano en alto",
    storage_path: "global/klk.png",
    category: "saludos",
    ...over,
  };
}

function emoji(over: Partial<CommunityEmoji> = {}): CommunityEmoji {
  return {
    id: "e-1",
    slug: "klk",
    label: "KLK",
    alt: "Saludo con la mano en alto",
    url: "https://cdn.test/klk.png",
    category: "saludos",
    scope: "global",
    ...over,
  };
}

describe("communityEmojiUrl", () => {
  const antes = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto.supabase.co";
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = antes;
  });

  it("arma la URL pública del bucket", () => {
    expect(communityEmojiUrl("global/klk.png")).toBe(
      "https://proyecto.supabase.co/storage/v1/object/public/community-emojis/global/klk.png",
    );
  });

  it("respeta una URL absoluta tal cual (assets de prueba, CDN)", () => {
    expect(communityEmojiUrl("https://otro.cdn/klk.png")).toBe("https://otro.cdn/klk.png");
  });
});

describe("toCommunityEmoji", () => {
  it("tenant_id null es catálogo GLOBAL", () => {
    expect(toCommunityEmoji(row()).scope).toBe("global");
  });

  it("con tenant_id es de la comunidad", () => {
    expect(toCommunityEmoji(row({ tenant_id: "t-1" })).scope).toBe("comunidad");
  });

  it("el alt de la base es el alt de la app: es lo único que escucha un lector de pantalla", () => {
    expect(toCommunityEmoji(row()).alt).toBe("Saludo con la mano en alto");
  });

  it("una categoría que este build no conoce no rompe: cae en 'general'", () => {
    expect(toCommunityEmoji(row({ category: "categoria-del-futuro" })).category).toBe("general");
  });
});

describe("resolveCommunityEmojiCategory", () => {
  it("acepta todas las del CHECK de la 0125", () => {
    for (const category of COMMUNITY_EMOJI_CATEGORIES) {
      expect(resolveCommunityEmojiCategory(category)).toBe(category);
    }
  });
});

describe("parseEmojiText — el código corto dentro de un comentario", () => {
  const catalogo = indexBySlug([emoji(), emoji({ id: "e-2", slug: "chevere", label: "CHÉVERE" })]);

  it("un texto sin códigos vuelve entero, en un solo tramo", () => {
    expect(parseEmojiText("hola vecina", catalogo)).toEqual([
      { kind: "text", text: "hola vecina" },
    ]);
  });

  it("parte el texto alrededor del código", () => {
    const tramos = parseEmojiText("hola :klk: qué tal", catalogo);
    expect(tramos.map((t) => t.kind)).toEqual(["text", "emoji", "text"]);
    expect(tramos[0]).toEqual({ kind: "text", text: "hola " });
    expect(tramos[2]).toEqual({ kind: "text", text: " qué tal" });
  });

  it("un código que NO está en el catálogo se deja escrito: no se le edita el mensaje a nadie", () => {
    expect(parseEmojiText("mirá :loquesea: esto", catalogo)).toEqual([
      { kind: "text", text: "mirá :loquesea: esto" },
    ]);
  });

  it("sin catálogo el texto se pinta tal cual", () => {
    expect(parseEmojiText("hola :klk:", new Map())).toEqual([{ kind: "text", text: "hola :klk:" }]);
  });

  it("corta en MAX_EMOJIS_IN_TEXT: un comentario no puede pedir cien imágenes", () => {
    const texto = ":klk: ".repeat(MAX_EMOJIS_IN_TEXT + 8);
    const pintados = parseEmojiText(texto, catalogo).filter((t) => t.kind === "emoji");
    expect(pintados).toHaveLength(MAX_EMOJIS_IN_TEXT);
  });

  it("dos llamadas seguidas dan lo mismo (la regex global no arrastra lastIndex)", () => {
    const primera = parseEmojiText("a :klk: b", catalogo);
    const segunda = parseEmojiText("a :klk: b", catalogo);
    expect(segunda).toEqual(primera);
  });

  it("emojiShortcode arma exactamente lo que el parser reconoce", () => {
    const tramos = parseEmojiText(emojiShortcode("chevere"), catalogo);
    expect(tramos).toHaveLength(1);
    expect(tramos[0]!.kind).toBe("emoji");
  });
});

describe("indexBySlug — el empate lo gana la comunidad", () => {
  const global = emoji({ id: "g", scope: "global", url: "https://cdn.test/global.png" });
  const propio = emoji({ id: "c", scope: "comunidad", url: "https://cdn.test/propio.png" });

  it("con el propio primero", () => {
    expect(indexBySlug([propio, global]).get("klk")?.id).toBe("c");
  });

  it("y con el global primero, que es donde se rompería si dependiera del orden", () => {
    expect(indexBySlug([global, propio]).get("klk")?.id).toBe("c");
  });
});

describe("groupByCategory", () => {
  it("no devuelve categorías vacías: nadie recorre cinco pestañas en blanco", () => {
    const grupos = groupByCategory([emoji({ category: "comida" })]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.category).toBe("comida");
  });

  it("respeta el orden del catálogo, no el de llegada", () => {
    const grupos = groupByCategory([
      emoji({ id: "1", category: "comida" }),
      emoji({ id: "2", category: "saludos" }),
    ]);
    expect(grupos.map((g) => g.category)).toEqual(["saludos", "comida"]);
  });

  it("dentro de una categoría conserva el orden en que vino (sort_order de la consulta)", () => {
    const grupos = groupByCategory([
      emoji({ id: "primero", slug: "a" }),
      emoji({ id: "segundo", slug: "b" }),
    ]);
    expect(grupos[0]!.emojis.map((e) => e.id)).toEqual(["primero", "segundo"]);
  });
});

describe("filterEmojis — el buscador del picker", () => {
  const catalogo = [
    emoji({ id: "1", slug: "chevere", label: "CHÉVERE" }),
    emoji({ id: "2", slug: "empanada", label: "EMPANADA" }),
  ];

  it("encuentra sin la tilde: nadie escribe É con el pulgar", () => {
    expect(filterEmojis(catalogo, "chevere").map((e) => e.id)).toEqual(["1"]);
  });

  it("también por código corto, que es lo que se aprende de memoria", () => {
    expect(filterEmojis(catalogo, "empanada").map((e) => e.id)).toEqual(["2"]);
  });

  it("sin búsqueda devuelve todo", () => {
    expect(filterEmojis(catalogo, "   ")).toHaveLength(2);
  });

  it("sin resultados devuelve vacío, no todo", () => {
    expect(filterEmojis(catalogo, "zzz")).toEqual([]);
  });
});
