import { describe, expect, it } from "vitest";
import {
  encodeRadioCookie,
  RADIO_DEFAULT,
  RADIO_SOLO_ZONA,
  RADIOS_MILLAS,
  radioAplicado,
  readRadioCookie,
  sanitizeRadio,
} from "./radio";

describe("sanitizeRadio — rechaza en vez de adivinar", () => {
  it("acepta los cinco escalones, como número y como texto", () => {
    for (const millas of RADIOS_MILLAS) {
      expect(sanitizeRadio(millas)).toBe(millas);
      expect(sanitizeRadio(String(millas))).toBe(millas);
      expect(sanitizeRadio(` ${millas} `)).toBe(millas);
    }
  });

  it("un valor que no está en la lista NO cae al default", () => {
    // Adivinar hacia arriba mostraría contenido de más lejos que lo que nadie
    // pidió. Esta feature existe para acercar, no para ampliar por accidente.
    expect(sanitizeRadio(37)).toBeNull();
    expect(sanitizeRadio(9999)).toBeNull();
    expect(sanitizeRadio(-25)).toBeNull();
    expect(sanitizeRadio(0)).toBeNull();
  });

  it("rechaza lo que no es un número", () => {
    expect(sanitizeRadio("veinticinco")).toBeNull();
    expect(sanitizeRadio(Number.NaN)).toBeNull();
    expect(sanitizeRadio(Number.POSITIVE_INFINITY)).toBeNull();
    expect(sanitizeRadio(null)).toBeNull();
    expect(sanitizeRadio(undefined)).toBeNull();
    expect(sanitizeRadio({})).toBeNull();
    expect(sanitizeRadio([25])).toBeNull();
  });

  it("el default que pidió el cliente es un escalón válido", () => {
    expect(RADIOS_MILLAS).toContain(RADIO_DEFAULT);
    expect(RADIO_DEFAULT).toBe(25);
  });
});

describe("la cookie: ida y vuelta", () => {
  it("un radio elegido sobrevive el viaje", () => {
    for (const millas of RADIOS_MILLAS) {
      expect(readRadioCookie(encodeRadioCookie(millas))).toEqual({
        modo: "radio",
        millas,
      });
    }
  });

  it("«solo mi zona» se GUARDA, no se borra", () => {
    // Mismo motivo que `ZONA_TODAS`: apagar borrando la cookie funciona hoy y
    // dejaría de funcionar el día que el default pase a ser 25 millas. La
    // decisión de apagarlo tiene que sobrevivir a ese cambio.
    expect(encodeRadioCookie(null)).toBe(RADIO_SOLO_ZONA);
    expect(readRadioCookie(RADIO_SOLO_ZONA)).toEqual({ modo: "solo" });
  });

  it("ningún radio válido puede hacerse pasar por el centinela", () => {
    for (const millas of RADIOS_MILLAS) {
      expect(encodeRadioCookie(millas)).not.toBe(RADIO_SOLO_ZONA);
    }
    expect(sanitizeRadio(RADIO_SOLO_ZONA)).toBeNull();
  });

  it("una cookie ausente o rota no dice nada", () => {
    expect(readRadioCookie(null)).toBeNull();
    expect(readRadioCookie(undefined)).toBeNull();
    expect(readRadioCookie("")).toBeNull();
    expect(readRadioCookie("37")).toBeNull();
    expect(readRadioCookie("cualquier cosa")).toBeNull();
    expect(readRadioCookie("__otro")).toBeNull();
  });
});

describe("radioAplicado — la decisión de producto, en un solo lugar", () => {
  it("sin cookie NO recorta: 25 millas está preseleccionado, no prendido", () => {
    // ESTE es el test que protege a quien nunca tocó el control. Un default
    // implícito le cambiaría de golpe lo que ve a toda la gente que hoy tiene
    // una zona elegida, sin que lo haya pedido.
    expect(radioAplicado(null)).toBeNull();
  });

  it("«solo mi zona» tampoco recorta por distancia", () => {
    expect(radioAplicado({ modo: "solo" })).toBeNull();
  });

  it("un radio elegido se aplica tal cual", () => {
    for (const millas of RADIOS_MILLAS) {
      expect(radioAplicado({ modo: "radio", millas })).toBe(millas);
    }
  });

  it("el camino completo desde el valor crudo de la cookie", () => {
    expect(radioAplicado(readRadioCookie(encodeRadioCookie(25)))).toBe(25);
    expect(radioAplicado(readRadioCookie(encodeRadioCookie(null)))).toBeNull();
    expect(radioAplicado(readRadioCookie("basura"))).toBeNull();
  });
});
