import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listingHref, listingKindLabel, toSavedListingTile } from "./saved-tile";

/**
 * Modelo puro de "Guardados". Entorno node: firstPhotoUrl/formatListingPrice
 * (@/components/listings/helpers) son puros, igual que post-tiles.test.ts.
 */

const SUPA = "https://proj.supabase.co";
const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL;
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA;
});
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = OLD;
});

const BASE_LISTING = {
  id: "l1",
  kind: "property",
  title: "Depto 2 ambientes en Queens",
  price_amount: 1500,
  price_currency: "USD",
  price_period: "month",
  area_label: "Queens",
  photos: ["tenant/listing/foto.webp"],
};

describe("listingHref", () => {
  it("resuelve la ruta pública de cada kind guardable hoy", () => {
    expect(listingHref("property", "id1")).toBe("/propiedades/id1");
    expect(listingHref("professional", "id2")).toBe("/profesionales/id2");
    expect(listingHref("event", "id3")).toBe("/eventos/id3");
    expect(listingHref("job", "id4")).toBe("/empleos/id4");
    expect(listingHref("product", "id5")).toBe("/marketplace/id5");
  });

  it("kind sin ruta pública (business/creator_gig) o desconocido → null", () => {
    expect(listingHref("business", "id6")).toBeNull();
    expect(listingHref("creator_gig", "id7")).toBeNull();
    expect(listingHref("algo-inventado", "id8")).toBeNull();
  });
});

describe("listingKindLabel", () => {
  it("etiqueta cada kind conocido en español", () => {
    expect(listingKindLabel("property")).toBe("Vivienda");
    expect(listingKindLabel("professional")).toBe("Profesional");
    expect(listingKindLabel("event")).toBe("Evento");
    expect(listingKindLabel("job")).toBe("Empleo");
    expect(listingKindLabel("product")).toBe("Producto");
  });

  it("kind desconocido cae a una etiqueta genérica, nunca undefined", () => {
    expect(listingKindLabel("business")).toBe("Aviso");
  });
});

describe("toSavedListingTile", () => {
  it("mapea un listing completo: href, precio, foto y zona", () => {
    const tile = toSavedListingTile(BASE_LISTING);
    expect(tile).not.toBeNull();
    expect(tile?.href).toBe("/propiedades/l1");
    expect(tile?.kind).toBe("property");
    expect(tile?.kindLabel).toBe("Vivienda");
    expect(tile?.title).toBe("Depto 2 ambientes en Queens");
    expect(tile?.priceLabel).toContain("1,500");
    expect(tile?.areaLabel).toBe("Queens");
    expect(tile?.photoUrl).toBe(
      `${SUPA}/storage/v1/object/public/listing-photos/tenant/listing/foto.webp`,
    );
  });

  it("sin precio → priceLabel null (no '$NaN' ni string vacío)", () => {
    const tile = toSavedListingTile({ ...BASE_LISTING, price_amount: null });
    expect(tile?.priceLabel).toBeNull();
  });

  it("sin fotos → photoUrl null", () => {
    const tile = toSavedListingTile({ ...BASE_LISTING, photos: [] });
    expect(tile?.photoUrl).toBeNull();
  });

  it("kind sin ruta pública hoy (business/creator_gig) → null, nunca un link roto", () => {
    expect(toSavedListingTile({ ...BASE_LISTING, kind: "business" })).toBeNull();
    expect(toSavedListingTile({ ...BASE_LISTING, kind: "creator_gig" })).toBeNull();
  });
});
