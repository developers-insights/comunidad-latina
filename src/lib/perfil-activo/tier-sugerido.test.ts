import { describe, expect, it } from "vitest";
import { tierDeIdentidadActiva } from "./tier-sugerido";
import { IDENTIDAD_PERSONAL, type IdentidadActiva, type IdentidadNegocio } from "./identidad";

const NEGOCIO: IdentidadNegocio = {
  businessId: "11111111-1111-4111-8111-111111111111",
  nombre: "Panadería Giovanni",
  categoria: "comida",
  listingId: null,
  rol: "propietario",
  esPropietario: true,
};

describe("tierDeIdentidadActiva", () => {
  it("identidad personal → escalón persona", () => {
    expect(tierDeIdentidadActiva(IDENTIDAD_PERSONAL)).toBe("persona");
  });

  it("actuando como negocio → escalón negocio", () => {
    const identidad: IdentidadActiva = { tipo: "negocio", negocio: NEGOCIO };
    expect(tierDeIdentidadActiva(identidad)).toBe("negocio");
  });

  it("nunca sugiere 'profesional': no hay señal de identidad para eso", () => {
    // Ver el docblock del módulo: "profesional" es una publicación del
    // directorio, no una identidad — así que ningún IdentidadActiva posible
    // puede producir ese resultado.
    const resultados: ReturnType<typeof tierDeIdentidadActiva>[] = [
      tierDeIdentidadActiva(IDENTIDAD_PERSONAL),
      tierDeIdentidadActiva({ tipo: "negocio", negocio: NEGOCIO }),
    ];
    expect(resultados).not.toContain("profesional");
  });

  it("un negocio con rol de administrador invitado también coincide con 'negocio'", () => {
    // El escalón sugerido depende de CON QUÉ se está actuando, no de si la
    // cuenta es propia — administrar un negocio ajeno (0031) también cuenta.
    const identidad: IdentidadActiva = {
      tipo: "negocio",
      negocio: { ...NEGOCIO, rol: "analista", esPropietario: false },
    };
    expect(tierDeIdentidadActiva(identidad)).toBe("negocio");
  });
});
