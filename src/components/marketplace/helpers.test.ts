import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  categoryShortLabel,
  conditionLabel,
  followerCountLabel,
  formatProductPrice,
  isProductCategory,
  isProductCondition,
  parseProductAttrs,
  PRODUCT_CATEGORIES,
  sanitizeSearchQuery,
} from "./helpers";

describe("parseProductAttrs", () => {
  it("lee store_listing_id, category y condition de un attrs válido", () => {
    expect(
      parseProductAttrs({
        store_listing_id: "11111111-1111-4111-8111-111111111111",
        category: "hogar",
        condition: "usado",
      }),
    ).toEqual({
      storeListingId: "11111111-1111-4111-8111-111111111111",
      category: "hogar",
      condition: "usado",
    });
  });

  it("degrada a null en vez de tirar con attrs vacío, null o con forma rara", () => {
    expect(parseProductAttrs({})).toEqual({
      storeListingId: null,
      category: null,
      condition: null,
    });
    expect(parseProductAttrs(null)).toEqual({
      storeListingId: null,
      category: null,
      condition: null,
    });
    expect(parseProductAttrs(["no", "es", "un", "objeto"])).toEqual({
      storeListingId: null,
      category: null,
      condition: null,
    });
  });

  it("ignora campos que no son string (nunca revienta con un número o un objeto)", () => {
    expect(
      parseProductAttrs({ store_listing_id: 123, category: { raro: true }, condition: "" }),
    ).toEqual({ storeListingId: null, category: null, condition: null });
  });
});

describe("isProductCategory / categoryLabel", () => {
  it("acepta solo las categorías del set curado", () => {
    expect(isProductCategory("hogar")).toBe(true);
    expect(isProductCategory("inventada")).toBe(false);
  });

  it("traduce un value conocido a su etiqueta legible", () => {
    expect(categoryLabel("ropa_accesorios")).toBe("Ropa y accesorios");
    expect(categoryLabel("electronica")).toBe("Electrónica");
  });

  it("capitaliza un value fuera del set curado en vez de mostrarlo crudo", () => {
    expect(categoryLabel("mascotas")).toBe("Mascotas");
  });

  it("devuelve null sin categoría", () => {
    expect(categoryLabel(null)).toBeNull();
  });
});

describe("categoryShortLabel", () => {
  it("traduce cada categoría del set curado a su etiqueta corta — cabe en el chip de la card (~170px)", () => {
    expect(categoryShortLabel("ropa_accesorios")).toBe("Ropa");
    expect(categoryShortLabel("comida_bebidas")).toBe("Comida");
    expect(categoryShortLabel("hogar")).toBe("Hogar");
    expect(categoryShortLabel("belleza_cuidado")).toBe("Belleza");
    expect(categoryShortLabel("electronica")).toBe("Electrónica");
    expect(categoryShortLabel("ninos_bebes")).toBe("Niños");
    expect(categoryShortLabel("artesanias")).toBe("Artesanías");
    expect(categoryShortLabel("otro")).toBe("Otro");
  });

  it("capitaliza un value fuera del set curado en vez de mostrarlo crudo (mismo fallback que categoryLabel)", () => {
    expect(categoryShortLabel("mascotas")).toBe("Mascotas");
  });

  it("devuelve null sin categoría", () => {
    expect(categoryShortLabel(null)).toBeNull();
  });
});

describe("isProductCondition / conditionLabel", () => {
  it("valida nuevo/usado y traduce a etiqueta", () => {
    expect(isProductCondition("nuevo")).toBe(true);
    expect(isProductCondition("reacondicionado")).toBe(false);
    expect(conditionLabel("nuevo")).toBe("Nuevo");
    expect(conditionLabel("usado")).toBe("Usado");
  });

  it("devuelve null sin condición o con una desconocida", () => {
    expect(conditionLabel(null)).toBeNull();
    expect(conditionLabel("reacondicionado")).toBeNull();
  });
});

describe("formatProductPrice", () => {
  it("formatea el monto con la moneda, sin sufijo de período (siempre one_time)", () => {
    expect(formatProductPrice(25, "USD")).toBe("$25");
  });

  it("devuelve null sin monto", () => {
    expect(formatProductPrice(null, "USD")).toBeNull();
  });
});

describe("followerCountLabel", () => {
  it("distingue cero / uno / muchos", () => {
    expect(followerCountLabel(0)).toBe("Sin seguidores todavía");
    expect(followerCountLabel(1)).toBe("1 seguidor");
    expect(followerCountLabel(12)).toBe("12 seguidores");
  });

  it("nunca queda en negativo por un dato raro de la DB", () => {
    expect(followerCountLabel(-3)).toBe("Sin seguidores todavía");
  });
});

describe("sanitizeSearchQuery", () => {
  it("recorta espacios sobrantes en los bordes", () => {
    expect(sanitizeSearchQuery("  zapatillas  ")).toBe("zapatillas");
  });

  it("corta a 120 caracteres — mismo cap que /propiedades", () => {
    const long = "a".repeat(200);
    expect(sanitizeSearchQuery(long)).toHaveLength(120);
  });

  it("una búsqueda vacía o solo espacios queda vacía (no filtra)", () => {
    expect(sanitizeSearchQuery("")).toBe("");
    expect(sanitizeSearchQuery("   ")).toBe("");
  });
});

describe("PRODUCT_CATEGORIES — límite del módulo (feedback cliente 21/7)", () => {
  it("nunca incluye 'negocio' como categoría de producto — un producto no es una tienda", () => {
    // Guarda de regresión: el reporte del cliente ("le puse negocio y me
    // sale como para propiedad") es un bug de /publicar (kind=business),
    // NO de este módulo — pero si algún día alguien agrega una categoría de
    // producto literal "negocio"/"business" acá, reintroduciría la misma
    // confusión conceptual (categoría de PRODUCTO vs. tipo de AVISO). El
    // "negocio" es la TIENDA (attrs.store_listing_id, kind='business'),
    // nunca una categoría dentro de PRODUCT_CATEGORIES.
    const values = PRODUCT_CATEGORIES.map((option) => option.value);
    expect(values).not.toContain("negocio");
    expect(values).not.toContain("business");
  });
});
