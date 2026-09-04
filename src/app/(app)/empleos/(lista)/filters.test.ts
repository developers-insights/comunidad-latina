import { describe, expect, it } from "vitest";

import { isEmpleosTab, parseFilters, toEmpleosTab } from "./filters";

/**
 * Validador de `?tipo=` de /empleos, ahora que el parámetro dejó de nombrar una
 * JORNADA y pasó a nombrar una PESTAÑA (feedback cliente 2026-09-03, punto 12).
 *
 * Dos promesas se prueban acá y son las dos que se rompen solas:
 *   1. los valores nuevos entran y cualquier basura cae a "Todos" sin romper la
 *      consulta;
 *   2. un link compartido ANTES del cambio (`?tipo=part_time`) sigue abriendo la
 *      pestaña correcta en vez de degradarse a "Todos".
 */

describe("isEmpleosTab", () => {
  it("acepta las tres pestañas y nada más", () => {
    expect(isEmpleosTab("empleos")).toBe(true);
    expect(isEmpleosTab("ocasional")).toBe(true);
    expect(isEmpleosTab("servicios")).toBe(true);
    expect(isEmpleosTab("freelance")).toBe(false);
    expect(isEmpleosTab("")).toBe(false);
  });

  it("una jornada vieja NO es una pestaña (se traduce, no se acepta tal cual)", () => {
    expect(isEmpleosTab("full_time")).toBe(false);
  });
});

describe("toEmpleosTab", () => {
  it("traduce las dos jornadas de empleo a la misma pestaña", () => {
    expect(toEmpleosTab("full_time")).toBe("empleos");
    expect(toEmpleosTab("part_time")).toBe("empleos");
  });

  it("la changa vieja aterriza en Ocasional", () => {
    expect(toEmpleosTab("one_off")).toBe("ocasional");
  });

  it("un valor inventado o vacío cae a 'Todos'", () => {
    expect(toEmpleosTab("gig")).toBe("");
    expect(toEmpleosTab("")).toBe("");
  });
});

describe("parseFilters", () => {
  it("toma las tres pestañas de la URL", () => {
    expect(parseFilters({ tipo: "empleos" }).tipo).toBe("empleos");
    expect(parseFilters({ tipo: "ocasional" }).tipo).toBe("ocasional");
    expect(parseFilters({ tipo: "servicios" }).tipo).toBe("servicios");
  });

  it("un link viejo sigue abriendo su pestaña", () => {
    expect(parseFilters({ tipo: "part_time" }).tipo).toBe("empleos");
    expect(parseFilters({ tipo: "one_off" }).tipo).toBe("ocasional");
  });

  it("un ?tipo= inválido cae al filtro vacío ('Todos'), no rompe la página", () => {
    expect(parseFilters({ tipo: "freelance" }).tipo).toBe("");
    expect(parseFilters({}).tipo).toBe("");
  });

  it("con arrays de query param (?tipo=a&tipo=b) usa sólo el primer valor", () => {
    expect(parseFilters({ tipo: ["servicios", "empleos"] }).tipo).toBe("servicios");
  });
});
