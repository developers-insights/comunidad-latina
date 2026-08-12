import { describe, expect, it } from "vitest";

import {
  distribucion,
  esPuntajeValido,
  estrellasLlenas,
  formatearPromedio,
  leerPromedio,
  puedeOfrecerseElFormulario,
  resumenDeStats,
} from "./resumen";

describe("leerPromedio", () => {
  it("acepta el numeric que PostgREST manda como string", () => {
    expect(leerPromedio("4.33")).toBe(4.33);
    expect(leerPromedio(4.33)).toBe(4.33);
  });

  it("null es null: 'todavía nadie opinó' no es un puntaje", () => {
    expect(leerPromedio(null)).toBeNull();
    expect(leerPromedio(undefined)).toBeNull();
  });

  it("descarta lo que no puede ser un promedio de 1 a 5", () => {
    expect(leerPromedio("0")).toBeNull();
    expect(leerPromedio(5.4)).toBeNull();
    expect(leerPromedio("hola")).toBeNull();
  });
});

describe("resumenDeStats", () => {
  it("sin fila todavía, el resumen es vacío y no cero", () => {
    expect(resumenDeStats(null)).toEqual({ promedio: null, cantidad: 0 });
    expect(resumenDeStats(undefined)).toEqual({ promedio: null, cantidad: 0 });
  });

  it("con cantidad en cero ignora cualquier promedio residual", () => {
    expect(resumenDeStats({ rating_avg: "4.00", rating_count: 0 })).toEqual({
      promedio: null,
      cantidad: 0,
    });
  });

  it("con reseñas devuelve promedio y cantidad", () => {
    expect(resumenDeStats({ rating_avg: "4.50", rating_count: 8 })).toEqual({
      promedio: 4.5,
      cantidad: 8,
    });
  });
});

describe("formatearPromedio", () => {
  it("una decimal y coma, como se escribe en español", () => {
    expect(formatearPromedio(4.33)).toBe("4,3");
    expect(formatearPromedio(4.06)).toBe("4,1");
    expect(formatearPromedio(4.94)).toBe("4,9");
    expect(formatearPromedio(5)).toBe("5,0");
    expect(formatearPromedio(1)).toBe("1,0");
  });

  it("sin promedio no inventa un número", () => {
    expect(formatearPromedio(null)).toBeNull();
  });
});

describe("estrellasLlenas", () => {
  it("redondea al entero más cercano", () => {
    expect(estrellasLlenas(4.4)).toBe(4);
    expect(estrellasLlenas(4.5)).toBe(5);
    expect(estrellasLlenas(1)).toBe(1);
  });

  it("sin promedio no pinta ninguna", () => {
    expect(estrellasLlenas(null)).toBe(0);
  });
});

describe("distribucion", () => {
  it("va de 5 a 1 y reparte los porcentajes", () => {
    const filas = distribucion([5, 5, 4, 1]);
    expect(filas.map((f) => f.puntaje)).toEqual([5, 4, 3, 2, 1]);
    expect(filas[0]).toEqual({ puntaje: 5, cantidad: 2, porcentaje: 50 });
    expect(filas[1]).toEqual({ puntaje: 4, cantidad: 1, porcentaje: 25 });
    expect(filas[2]).toEqual({ puntaje: 3, cantidad: 0, porcentaje: 0 });
  });

  it("sin datos no divide por cero", () => {
    expect(distribucion([]).every((f) => f.cantidad === 0 && f.porcentaje === 0)).toBe(true);
  });

  it("ignora puntajes imposibles en vez de contarlos", () => {
    const filas = distribucion([5, 0, 7, 3.5]);
    expect(filas[0]?.cantidad).toBe(1);
    expect(filas[0]?.porcentaje).toBe(100);
  });
});

describe("esPuntajeValido", () => {
  it("acepta los cinco enteros y nada más", () => {
    expect([1, 2, 3, 4, 5].every(esPuntajeValido)).toBe(true);
    expect(esPuntajeValido(0)).toBe(false);
    expect(esPuntajeValido(6)).toBe(false);
    expect(esPuntajeValido(4.5)).toBe(false);
    expect(esPuntajeValido("5")).toBe(false);
    expect(esPuntajeValido(null)).toBe(false);
  });
});

describe("puedeOfrecerseElFormulario", () => {
  const base = {
    usuarioId: "u1",
    publicadoPor: "otro",
    administraElAviso: false,
    estadoDelAviso: "published",
  };

  it("una persona con cuenta, ajena al negocio, puede reseñar", () => {
    expect(puedeOfrecerseElFormulario(base)).toBe(true);
  });

  it("sin sesión no se ofrece el formulario", () => {
    expect(puedeOfrecerseElFormulario({ ...base, usuarioId: null })).toBe(false);
  });

  it("no se reseña el negocio propio", () => {
    expect(puedeOfrecerseElFormulario({ ...base, publicadoPor: "u1" })).toBe(false);
  });

  it("tampoco lo reseña quien lo administra", () => {
    expect(puedeOfrecerseElFormulario({ ...base, administraElAviso: true })).toBe(false);
  });

  it("un aviso que no está publicado no se reseña", () => {
    expect(puedeOfrecerseElFormulario({ ...base, estadoDelAviso: "pending_review" })).toBe(false);
  });
});
