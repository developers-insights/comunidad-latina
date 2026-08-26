import { describe, expect, it } from "vitest";
import {
  PROPIEDADES_TAB_IDS,
  parsePropiedadesTab,
  propiedadesTabHref,
} from "./propiedades-tabs";

describe("parsePropiedadesTab", () => {
  it("reconoce 'propiedades' y 'agentes'", () => {
    expect(parsePropiedadesTab("propiedades")).toBe("propiedades");
    expect(parsePropiedadesTab("agentes")).toBe("agentes");
  });

  it("es insensible a mayúsculas y a espacios sobrantes", () => {
    expect(parsePropiedadesTab("  Agentes  ")).toBe("agentes");
    expect(parsePropiedadesTab("PROPIEDADES")).toBe("propiedades");
  });

  it("sin valor (undefined) cae en 'propiedades' — la pestaña canónica de /propiedades", () => {
    expect(parsePropiedadesTab(undefined)).toBe("propiedades");
  });

  it("un valor vacío o inventado también cae en 'propiedades', nunca revienta", () => {
    expect(parsePropiedadesTab("")).toBe("propiedades");
    expect(parsePropiedadesTab("negocios")).toBe("propiedades");
    expect(parsePropiedadesTab("<script>")).toBe("propiedades");
  });
});

describe("propiedadesTabHref", () => {
  it("'propiedades' es la URL canónica, sin query — no rompe ningún enlace existente al módulo", () => {
    expect(propiedadesTabHref("propiedades")).toBe("/propiedades");
  });

  it("'agentes' lleva su propio ?t=", () => {
    expect(propiedadesTabHref("agentes")).toBe("/propiedades?t=agentes");
  });

  it("toda pestaña de PROPIEDADES_TAB_IDS produce un href navegable", () => {
    for (const tab of PROPIEDADES_TAB_IDS) {
      expect(propiedadesTabHref(tab)).toMatch(/^\/propiedades/);
    }
  });
});
