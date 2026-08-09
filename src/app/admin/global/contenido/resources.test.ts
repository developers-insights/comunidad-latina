import { describe, expect, it } from "vitest";
import { DEFAULT_RESOURCE, isResourceKey, RESOURCES, RESOURCE_KEYS } from "./resources";

/**
 * El pliego enumera NUEVE cosas que el súper admin tiene que poder ver por
 * dominio. Este test es la lista del pliego escrita como aserción: si alguien
 * saca una sección "porque no se usa", el gate se pone en rojo y la
 * conversación pasa por acá en vez de por una entrega incompleta.
 */

const PLIEGO = [
  "usuarios",
  "publicaciones",
  "negocios",
  "profesionales",
  "empleos",
  "propiedades",
  "eventos",
  "marketplace",
  "influencers",
] as const;

describe("catálogo de listados por comunidad", () => {
  it("están las nueve secciones que pide el pliego", () => {
    expect([...RESOURCE_KEYS]).toEqual([...PLIEGO]);
  });

  it("cada sección sabe de dónde salen sus datos y qué decir si está vacía", () => {
    for (const key of RESOURCE_KEYS) {
      const definition = RESOURCES[key];
      expect(definition.key).toBe(key);
      expect(definition.label.length).toBeGreaterThan(0);
      // Un estado vacío que solo diga "no hay nada" no guía: se exige mensaje.
      expect(definition.emptyTitle.length).toBeGreaterThan(0);
      expect(definition.emptyMessage.length).toBeGreaterThan(10);
      expect(definition.source.table).toBeTruthy();
    }
  });

  it("los seis verticales de `listings` piden kinds distintos entre sí", () => {
    const kinds = RESOURCE_KEYS.map((key) => RESOURCES[key].source)
      .filter((source) => source.table === "listings")
      .map((source) => (source as { kind: string }).kind);

    expect(kinds).toHaveLength(6);
    expect(new Set(kinds).size).toBe(6);
  });

  it("un `recurso` inventado en la URL no pasa el filtro", () => {
    expect(isResourceKey("usuarios")).toBe(true);
    expect(isResourceKey("listings")).toBe(false);
    expect(isResourceKey("../../etc")).toBe(false);
    expect(isResourceKey(undefined)).toBe(false);
  });

  it("el default es una sección real", () => {
    expect(isResourceKey(DEFAULT_RESOURCE)).toBe(true);
  });
});
