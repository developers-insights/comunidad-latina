import { describe, expect, it } from "vitest";

import {
  etiquetaDeDias,
  etiquetaDeDisponibilidad,
  etiquetaDePrecioDesde,
  readServiceDetails,
} from "./servicios";

/**
 * Contrato del aviso de SERVICIO (feedback cliente 2026-09-03, punto 12).
 *
 * Lo que se prueba acá es lo que el cliente dictó con sus propias palabras —
 * "soy jardinero, disponible sábados y domingos"— y las dos maneras en que eso
 * puede salir mal en pantalla: días crudos en inglés, y un precio de referencia
 * disfrazado de tarifa cerrada.
 */

describe("readServiceDetails", () => {
  it("lee días y horario de las MISMAS claves que ya usa un empleo", () => {
    expect(
      readServiceDetails({ work_days: ["sun", "sat"], schedule: "  de 9 a 17  " }),
    ).toEqual({ days: ["sat", "sun"], schedule: "de 9 a 17" });
  });

  it("un aviso sin disponibilidad declarada devuelve ausencia, no vacíos inventados", () => {
    expect(readServiceDetails({})).toEqual({ days: [], schedule: null });
    expect(readServiceDetails(null)).toEqual({ days: [], schedule: null });
    expect(readServiceDetails("cualquier cosa")).toEqual({ days: [], schedule: null });
  });

  it("descarta un día que no está en el catálogo en vez de romperse", () => {
    expect(readServiceDetails({ work_days: ["sat", "caturday"] }).days).toEqual(["sat"]);
  });
});

describe("etiquetaDeDias", () => {
  it("dice el caso del cliente tal como lo dijo él", () => {
    expect(etiquetaDeDias(["sat", "sun"])).toBe("Sábados y domingos");
  });

  it("una racha larga se dice como rango", () => {
    expect(etiquetaDeDias(["mon", "tue", "wed", "thu", "fri"])).toBe("Lunes a viernes");
  });

  it("los siete días tienen su propia frase", () => {
    expect(etiquetaDeDias(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).toBe(
      "Todos los días",
    );
  });

  it("días sueltos se enumeran con 'y' antes del último", () => {
    expect(etiquetaDeDias(["mon", "wed", "fri"])).toBe("Lunes, miércoles y viernes");
  });

  it("un solo día no lleva conector", () => {
    expect(etiquetaDeDias(["sun"])).toBe("Domingos");
  });

  it("respeta el orden de la semana aunque lleguen desordenados", () => {
    expect(etiquetaDeDias(["fri", "mon"])).toBe("Lunes y viernes");
  });

  it("sin días declarados no hay etiqueta", () => {
    expect(etiquetaDeDias([])).toBeNull();
  });
});

describe("etiquetaDeDisponibilidad", () => {
  it("junta días y horario en una línea", () => {
    expect(
      etiquetaDeDisponibilidad({ days: ["sat", "sun"], schedule: "de 8 a 14" }),
    ).toBe("Sábados y domingos · de 8 a 14");
  });

  it("con sólo uno de los dos, no deja el separador colgando", () => {
    expect(etiquetaDeDisponibilidad({ days: [], schedule: "a coordinar" })).toBe(
      "a coordinar",
    );
    expect(etiquetaDeDisponibilidad({ days: ["sat"], schedule: null })).toBe("Sábados");
  });

  it("sin nada declarado devuelve null (la pantalla dibuja la ausencia)", () => {
    expect(etiquetaDeDisponibilidad({ days: [], schedule: null })).toBeNull();
  });
});

describe("etiquetaDePrecioDesde", () => {
  it("el monto es una referencia y se dice como tal", () => {
    // El formato del monto lo decide `formatListingPrice` (y el locale del
    // tenant); acá sólo se fija que el "Desde" viaja adelante y el sufijo del
    // período detrás.
    expect(etiquetaDePrecioDesde(25, "USD", "hour")).toBe("Desde $25/hora");
  });

  it("sin monto NO inventa un texto: 'a convenir' es copy de pantalla", () => {
    expect(etiquetaDePrecioDesde(null, "USD", "hour")).toBeNull();
  });
});
