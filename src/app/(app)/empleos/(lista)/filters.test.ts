import { describe, expect, it } from "vitest";

import { isEmploymentType, parseFilters } from "./filters";

/**
 * Validador de `?tipo=` de /empleos (L1 — changas, "one_off"). Lo que importa
 * acá es que el filtro de la URL sea tan permisivo como el resto del módulo:
 * acepta las tres categorías vigentes y degrada CUALQUIER otra cosa a "Todos"
 * en vez de romper la query o colar un valor que `fetchJobsPage` no espera.
 */

describe("isEmploymentType", () => {
  it("acepta las tres categorías vigentes, incluida la changa", () => {
    expect(isEmploymentType("full_time")).toBe(true);
    expect(isEmploymentType("part_time")).toBe(true);
    expect(isEmploymentType("one_off")).toBe(true);
  });

  it("rechaza un valor inventado, vacío o de un aviso viejo/descontinuado", () => {
    expect(isEmploymentType("freelance")).toBe(false);
    expect(isEmploymentType("gig")).toBe(false);
    expect(isEmploymentType("")).toBe(false);
  });
});

describe("parseFilters", () => {
  it("toma 'one_off' de la URL igual que los otros dos tipos", () => {
    expect(parseFilters({ tipo: "one_off" }).tipo).toBe("one_off");
  });

  it("un ?tipo= inválido cae al filtro vacío ('Todos'), no rompe la página", () => {
    expect(parseFilters({ tipo: "freelance" }).tipo).toBe("");
    expect(parseFilters({}).tipo).toBe("");
  });

  it("con arrays de query param (?tipo=a&tipo=b) usa sólo el primer valor", () => {
    expect(parseFilters({ tipo: ["one_off", "full_time"] }).tipo).toBe("one_off");
  });
});
