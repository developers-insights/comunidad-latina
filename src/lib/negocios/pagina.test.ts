import { describe, expect, it } from "vitest";
import {
  LOGO_LADO_MINIMO,
  MAX_SERVICIOS,
  PORTADA_ANCHO_MINIMO,
  esPathDeEsteNegocio,
  normalizarServicios,
  pathDeFotoDeNegocio,
  problemaDeDimensiones,
  problemaDeServicios,
} from "./pagina";

/**
 * Las reglas que la base también aplica (CHECK `listings_services_shape` y
 * `guardar_pagina_de_negocio`, 0127). Se prueban acá porque es el único lugar
 * donde se pueden probar sin una base: si estas se desincronizan de la
 * migración, el síntoma en producción es un 23514 que la persona lee como
 * "algo salió mal".
 */
describe("normalizarServicios", () => {
  it("recorta, colapsa espacios y descarta los vacíos", () => {
    expect(normalizarServicios(["  Plomería  ", "", "   ", "Techos   nuevos"])).toEqual([
      "Plomería",
      "Techos nuevos",
    ]);
  });

  it("saca repetidos sin distinguir mayúsculas ni espacios de más", () => {
    // Dos filas idénticas en la página pública se leen como un error del
    // negocio, no como una decisión suya.
    expect(normalizarServicios(["Plomería", "plomería", "PLOMERÍA "])).toEqual([
      "Plomería",
    ]);
  });

  it("conserva el orden en que la persona los escribió", () => {
    expect(normalizarServicios(["Techos", "Pisos", "Baños"])).toEqual([
      "Techos",
      "Pisos",
      "Baños",
    ]);
  });

  it("corta en el tope y no explota", () => {
    const veinte = Array.from({ length: 20 }, (_, i) => `Servicio ${i + 1}`);
    const salida = normalizarServicios(veinte);

    expect(salida).toHaveLength(MAX_SERVICIOS);
    expect(salida[0]).toBe("Servicio 1");
    expect(salida.at(-1)).toBe(`Servicio ${MAX_SERVICIOS}`);
  });
});

describe("problemaDeServicios", () => {
  it("una lista normal no tiene problema", () => {
    expect(problemaDeServicios(["Plomería", "Electricidad"])).toBeNull();
  });

  it("detecta más ítems que el tope (el camino que no pasa por el formulario)", () => {
    const trece = Array.from({ length: MAX_SERVICIOS + 1 }, (_, i) => `S${i}`);
    expect(problemaDeServicios(trece)).toBe("demasiados");
  });

  it("detecta un ítem más largo que el máximo", () => {
    expect(problemaDeServicios(["x".repeat(61)])).toBe("muy_largo");
    expect(problemaDeServicios(["x".repeat(60)])).toBeNull();
  });
});

describe("problemaDeDimensiones", () => {
  it("el logo chico se rechaza y el que llega al mínimo pasa", () => {
    expect(problemaDeDimensiones("logo", 120, 120)).toBe("chica");
    expect(problemaDeDimensiones("logo", LOGO_LADO_MINIMO, LOGO_LADO_MINIMO)).toBeNull();
  });

  it("la portada exige ancho de banner, no un cuadrado chico", () => {
    expect(problemaDeDimensiones("portada", 400, 300)).toBe("chica");
    expect(problemaDeDimensiones("portada", PORTADA_ANCHO_MINIMO, 400)).toBeNull();
  });

  it("una imagen desmedida se rechaza (bomba de descompresión)", () => {
    expect(problemaDeDimensiones("logo", 30000, 30000)).toBe("enorme");
  });

  it("dimensiones imposibles se leen como ilegible, no como válidas", () => {
    expect(problemaDeDimensiones("logo", 0, 500)).toBe("ilegible");
    expect(problemaDeDimensiones("logo", Number.NaN, 500)).toBe("ilegible");
  });
});

describe("path del bucket", () => {
  const TENANT = "11111111-1111-4111-8111-111111111111";
  const LISTING = "22222222-2222-4222-8222-222222222222";

  it("arma el path canónico {tenant}/{listing}/ con su prefijo legible", () => {
    const path = pathDeFotoDeNegocio("logo", TENANT, LISTING, "abc");

    expect(path).toBe(`${TENANT}/${LISTING}/logo-abc.webp`);
    expect(esPathDeEsteNegocio(path, TENANT, LISTING)).toBe(true);
  });

  it("la portada se distingue del logo en el propio nombre", () => {
    expect(pathDeFotoDeNegocio("portada", TENANT, LISTING, "abc")).toContain("/portada-");
  });

  it("rechaza la carpeta de otro aviso y los recorridos de directorio", () => {
    const ajeno = `${TENANT}/33333333-3333-4333-8333-333333333333/logo-x.webp`;
    expect(esPathDeEsteNegocio(ajeno, TENANT, LISTING)).toBe(false);
    expect(esPathDeEsteNegocio(`${TENANT}/${LISTING}/../x.webp`, TENANT, LISTING)).toBe(
      false,
    );
  });
});
