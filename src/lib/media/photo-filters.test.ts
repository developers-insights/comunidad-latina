import { describe, expect, it } from "vitest";
import { DEFAULT_PHOTO_FILTER_ID, getPhotoFilter, PHOTO_FILTERS } from "./photo-filters";

/**
 * Datos puros — sin DOM, sin React (por eso el test corre en el entorno
 * `node`, no hace falta `@vitest-environment jsdom`).
 */

describe("PHOTO_FILTERS", () => {
  it("trae entre 6 y 10 presets, como pide el contrato", () => {
    expect(PHOTO_FILTERS.length).toBeGreaterThanOrEqual(6);
    expect(PHOTO_FILTERS.length).toBeLessThanOrEqual(10);
  });

  it("el primero es 'Original', sin filtro (css vacío)", () => {
    expect(PHOTO_FILTERS[0].id).toBe(DEFAULT_PHOTO_FILTER_ID);
    expect(PHOTO_FILTERS[0].label).toBe("Original");
    expect(PHOTO_FILTERS[0].css).toBe("");
  });

  it("todos los ids son únicos", () => {
    const ids = PHOTO_FILTERS.map((filter) => filter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ningún filtro (salvo Original) tiene el css vacío", () => {
    for (const filter of PHOTO_FILTERS.slice(1)) {
      expect(filter.css.length).toBeGreaterThan(0);
    }
  });

  it("los nombres son español natural, no jerga de editor de fotos", () => {
    const bannedJargon = /curves|hsl|clarity|vibrance|saturation|lut/i;
    for (const filter of PHOTO_FILTERS) {
      expect(filter.label).not.toMatch(bannedJargon);
    }
  });
});

describe("getPhotoFilter", () => {
  it("devuelve el preset por id", () => {
    expect(getPhotoFilter("byn").label).toBe("Blanco y negro");
  });

  it("cae a 'Original' con un id que no existe", () => {
    expect(getPhotoFilter("no-existe").id).toBe(DEFAULT_PHOTO_FILTER_ID);
  });

  it("cae a 'Original' con undefined o null", () => {
    expect(getPhotoFilter(undefined).id).toBe(DEFAULT_PHOTO_FILTER_ID);
    expect(getPhotoFilter(null).id).toBe(DEFAULT_PHOTO_FILTER_ID);
  });
});
