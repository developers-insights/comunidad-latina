import { describe, expect, it } from "vitest";
import {
  PROPERTY_TAB_IDS,
  PROPERTY_TAB_LABELS,
  parsePropertyTab,
  propertyTabHref,
} from "./property-tabs";

/**
 * Lo que estos tests protegen es la URL. `/propiedades` está linkeada desde el
 * menú, desde `/buscar`, desde el círculo del módulo en el feed y desde varios
 * CTAs: el día que el directorio de agentes pase a ser lo que abre por default
 * sin que nadie lo decida, todos esos enlaces cambian de significado en
 * silencio. Es el mismo contrato que cubre `business-tabs.test.ts`.
 */

describe("parsePropertyTab", () => {
  it("ofrece exactamente las dos pestañas de la spec", () => {
    expect([...PROPERTY_TAB_IDS]).toEqual(["propiedades", "agentes"]);
  });

  it("el listado es el default de todo lo que no matchea", () => {
    for (const raw of [undefined, "", "   ", "inventado", "agents", "ofertas"]) {
      expect(parsePropertyTab(raw)).toBe("propiedades");
    }
  });

  it("acepta el valor con espacios o en mayúsculas — una URL copiada a mano", () => {
    expect(parsePropertyTab("  AGENTES ")).toBe("agentes");
    expect(parsePropertyTab("Agentes")).toBe("agentes");
  });

  it("cada pestaña tiene su etiqueta, con el nombre textual de la spec", () => {
    expect(PROPERTY_TAB_LABELS.propiedades).toBe("Propiedades");
    expect(PROPERTY_TAB_LABELS.agentes).toBe("Agentes y propietarios");
  });
});

describe("propertyTabHref", () => {
  it("el listado es la URL canónica, sin query", () => {
    expect(propertyTabHref("propiedades")).toBe("/propiedades");
  });

  it("la otra pestaña lleva un solo parámetro", () => {
    expect(propertyTabHref("agentes")).toBe("/propiedades?t=agentes");
  });

  it("toda URL que genera vuelve a parsearse a la misma pestaña", () => {
    for (const tab of PROPERTY_TAB_IDS) {
      const href = propertyTabHref(tab);
      const t = new URL(href, "https://x.test").searchParams.get("t");
      expect(parsePropertyTab(t ?? undefined)).toBe(tab);
    }
  });
});
