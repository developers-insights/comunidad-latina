import { describe, expect, it } from "vitest";
import {
  MARKETPLACE_TAB_IDS,
  marketplaceTabHref,
  parseMarketplaceTab,
} from "./marketplace-tabs";

describe("parseMarketplaceTab", () => {
  it("reconoce 'tiendas' y 'articulos'", () => {
    expect(parseMarketplaceTab("tiendas")).toBe("tiendas");
    expect(parseMarketplaceTab("articulos")).toBe("articulos");
  });

  it("es insensible a mayúsculas y a espacios sobrantes", () => {
    expect(parseMarketplaceTab("  Tiendas  ")).toBe("tiendas");
    expect(parseMarketplaceTab("ARTICULOS")).toBe("articulos");
  });

  it("sin valor (undefined) cae en 'articulos' — la pestaña canónica de /marketplace", () => {
    expect(parseMarketplaceTab(undefined)).toBe("articulos");
  });

  it("un valor vacío o inventado también cae en 'articulos', nunca revienta", () => {
    expect(parseMarketplaceTab("")).toBe("articulos");
    expect(parseMarketplaceTab("negocios")).toBe("articulos");
    expect(parseMarketplaceTab("<script>")).toBe("articulos");
  });
});

describe("marketplaceTabHref", () => {
  it("'articulos' es la URL canónica, sin query — no rompe enlaces existentes al Marketplace", () => {
    expect(marketplaceTabHref("articulos")).toBe("/marketplace");
  });

  it("'tiendas' lleva su propio ?t=", () => {
    expect(marketplaceTabHref("tiendas")).toBe("/marketplace?t=tiendas");
  });

  it("toda pestaña de MARKETPLACE_TAB_IDS produce un href navegable", () => {
    for (const tab of MARKETPLACE_TAB_IDS) {
      expect(marketplaceTabHref(tab)).toMatch(/^\/marketplace/);
    }
  });
});
