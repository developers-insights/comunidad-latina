import { describe, expect, it } from "vitest";
import {
  PROFESSIONALS_TAB_IDS,
  PROFESSIONALS_TAB_LABELS,
  parseProfessionalsTab,
  professionalsTabHref,
} from "./professional-tabs";

/**
 * Parser de la pestaña de Profesionales (`?t=`). Lógica pura, entorno node.
 */

describe("parseProfessionalsTab", () => {
  it("sin query → 'profesionales' (pestaña por defecto)", () => {
    expect(parseProfessionalsTab(undefined)).toBe("profesionales");
  });

  it("'publicaciones' → la pestaña de publicaciones", () => {
    expect(parseProfessionalsTab("publicaciones")).toBe("publicaciones");
  });

  it("mayúsculas y espacios no rompen el match", () => {
    expect(parseProfessionalsTab(" Publicaciones ")).toBe("publicaciones");
    expect(parseProfessionalsTab("PUBLICACIONES")).toBe("publicaciones");
  });

  it("cualquier valor inválido cae en 'profesionales', nunca en un error", () => {
    expect(parseProfessionalsTab("")).toBe("profesionales");
    expect(parseProfessionalsTab("fotos")).toBe("profesionales");
    expect(parseProfessionalsTab("<script>")).toBe("profesionales");
    expect(parseProfessionalsTab("profesionales-viejo")).toBe("profesionales");
  });
});

describe("professionalsTabHref", () => {
  it("'profesionales' es la URL canónica, sin query string", () => {
    expect(professionalsTabHref("profesionales")).toBe("/profesionales");
  });

  it("'publicaciones' lleva ?t=publicaciones", () => {
    expect(professionalsTabHref("publicaciones")).toBe("/profesionales?t=publicaciones");
  });
});

describe("PROFESSIONALS_TAB_IDS / PROFESSIONALS_TAB_LABELS", () => {
  it("hay exactamente dos pestañas, en el orden del pedido del cliente", () => {
    expect(PROFESSIONALS_TAB_IDS).toEqual(["profesionales", "publicaciones"]);
  });

  it("cada id tiene su etiqueta legible", () => {
    for (const id of PROFESSIONALS_TAB_IDS) {
      expect(PROFESSIONALS_TAB_LABELS[id]).toBeTruthy();
    }
    expect(PROFESSIONALS_TAB_LABELS.profesionales).toBe("Profesionales");
    expect(PROFESSIONALS_TAB_LABELS.publicaciones).toBe("Publicaciones");
  });
});
