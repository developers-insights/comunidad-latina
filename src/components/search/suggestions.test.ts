import { describe, expect, it } from "vitest";
import { MAX_SUGGESTIONS, buildSuggestions, foldForMatch } from "./suggestions";

describe("foldForMatch", () => {
  it("saca acentos y baja a minúscula (se tipea 'bogota', dice 'Bogotá')", () => {
    expect(foldForMatch("Bogotá")).toBe("bogota");
    expect(foldForMatch("ENVÍOS")).toBe("envios");
  });
});

describe("buildSuggestions", () => {
  const zones = ["Bogotá", "Barranquilla", "Medellín", "Santo Domingo"];

  it("no sugiere nada sin término", () => {
    expect(buildSuggestions("", { zones })).toEqual([]);
    expect(buildSuggestions("   ", { zones })).toEqual([]);
  });

  it("matchea por prefijo de palabra, no por substring suelto", () => {
    const terms = buildSuggestions("bo", { zones }).map((s) => s.term);
    expect(terms).toContain("Bogotá");
    // "Santo Domingo" contiene "o" y "om" en el medio: no se sugiere por eso.
    expect(buildSuggestions("om", { zones })).toEqual([]);
  });

  it("encuentra por la SEGUNDA palabra ('domingo' → Santo Domingo)", () => {
    expect(buildSuggestions("domi", { zones }).map((s) => s.term)).toContain("Santo Domingo");
  });

  it("ignora acentos para encontrar ('medell' → Medellín)", () => {
    expect(buildSuggestions("medell", { zones }).map((s) => s.term)).toContain("Medellín");
  });

  it("ofrece la grafía que SÍ está en los datos aunque suene igual a lo tipeado", () => {
    // `global_search` no aplica unaccent (migración 0044): "bogotá" y "Bogota"
    // producen tsquery distintas, así que esta sugerencia no es redundante —
    // es la que hace que la búsqueda encuentre algo.
    expect(buildSuggestions("bogotá", { zones: ["Bogota"] }).map((s) => s.term)).toContain(
      "Bogota",
    );
  });

  it("no repite en pantalla dos grafías del mismo nombre", () => {
    const terms = buildSuggestions("bogo", { zones: ["Bogotá", "Bogota"] }).map((s) => s.term);
    expect(terms).toHaveLength(1);
  });

  it("pone el historial primero: es lo que esa persona YA buscó", () => {
    const result = buildSuggestions("ba", { zones, history: ["Baño compartido"] });
    expect(result[0]).toEqual({ kind: "historial", term: "Baño compartido" });
    expect(result.map((s) => s.term)).toContain("Barranquilla");
  });

  it("sugiere categorías reales de los módulos", () => {
    const terms = buildSuggestions("elect", {}).map((s) => s.term);
    expect(terms).toContain("Electrónica");
    expect(buildSuggestions("abog", {}).map((s) => s.term)).toContain("Abogado");
    expect(buildSuggestions("restau", {}).map((s) => s.term)).toContain("Restaurante");
  });

  it("no se sugiere a sí mismo (sería un botón que no hace nada)", () => {
    expect(buildSuggestions("Bogotá", { zones }).map((s) => s.term)).not.toContain("Bogotá");
  });

  it("no repite el mismo término desde dos fuentes", () => {
    const terms = buildSuggestions("bogo", {
      zones: ["Bogotá"],
      history: ["Bogotá"],
    }).map((s) => s.term);
    expect(terms.filter((term) => term === "Bogotá")).toHaveLength(1);
  });

  it("nunca tapa los resultados: tope duro de sugerencias", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Zona ${i}`);
    expect(buildSuggestions("zona", { zones: many }).length).toBeLessThanOrEqual(
      MAX_SUGGESTIONS,
    );
  });
});
