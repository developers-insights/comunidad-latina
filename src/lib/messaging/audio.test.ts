import { describe, expect, it } from "vitest";
import {
  CANDIDATOS_DE_GRABACION,
  MAX_DURACION_AUDIO_MS,
  PICOS_DE_ONDA,
  calcularOnda,
  elegirMimeDeGrabacion,
  esOndaValida,
  etiquetaDeVelocidad,
  formatearDuracion,
  siguienteVelocidad,
  VELOCIDADES_DE_REPRODUCCION,
} from "./audio";
import { TIPOS_DE_ADJUNTO } from "./adjuntos";

/**
 * Lo que se puede probar de una nota de voz sin un navegador: la elección de
 * códec (inyectando el soporte de cada motor) y la matemática de la onda.
 */

/** Soporte real de Chrome/Firefox de escritorio y Android. */
const COMO_CHROME = new Set([
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
]);

/**
 * Soporte real de Safari e iOS. NO tiene webm — es exactamente el caso que
 * rompe la feature en la mitad de los teléfonos si se asume `codecs=opus`.
 */
const COMO_SAFARI = new Set(["audio/mp4;codecs=mp4a.40.2", "audio/mp4"]);

function soporteDe(conjunto: Set<string>) {
  return (mime: string) => conjunto.has(mime);
}

describe("elegirMimeDeGrabacion", () => {
  it("en Chrome elige opus en webm y guarda el tipo PELADO", () => {
    expect(elegirMimeDeGrabacion(soporteDe(COMO_CHROME))).toEqual({
      grabacion: "audio/webm;codecs=opus",
      almacenamiento: "audio/webm",
    });
  });

  it("en Safari/iOS cae a mp4 en vez de devolver un webm que no puede grabar", () => {
    expect(elegirMimeDeGrabacion(soporteDe(COMO_SAFARI))).toEqual({
      grabacion: "audio/mp4;codecs=mp4a.40.2",
      almacenamiento: "audio/mp4",
    });
  });

  it("sin ningún formato soportado devuelve null (la UI apaga el micrófono)", () => {
    expect(elegirMimeDeGrabacion(() => false)).toBeNull();
  });

  it("respeta el orden: si sólo hay webm sin codecs, no inventa el parámetro", () => {
    const elegido = elegirMimeDeGrabacion(soporteDe(new Set(["audio/webm"])));
    expect(elegido).toEqual({ grabacion: "audio/webm", almacenamiento: "audio/webm" });
  });

  /**
   * El fallo que este test previene: grabar en un formato que el bucket rechaza
   * con un 400 recién al subir, con el audio ya en la mano de la persona.
   */
  it("todo lo que se puede grabar se puede subir: el tipo de almacenamiento está en el catálogo", () => {
    for (const candidato of CANDIDATOS_DE_GRABACION) {
      expect(Object.keys(TIPOS_DE_ADJUNTO)).toContain(candidato.almacenamiento);
    }
  });

  it("el tipo de almacenamiento nunca lleva parámetros", () => {
    for (const candidato of CANDIDATOS_DE_GRABACION) {
      expect(candidato.almacenamiento).not.toContain(";");
    }
  });
});

describe("calcularOnda", () => {
  it("devuelve exactamente la cantidad de picos pedida", () => {
    expect(calcularOnda(new Float32Array(1000), 12)).toHaveLength(12);
    expect(calcularOnda(new Float32Array(1000))).toHaveLength(PICOS_DE_ONDA);
  });

  it("normaliza contra el pico propio: un susurro se dibuja como un grito", () => {
    const fuerte = calcularOnda([0, 1, 0, 0.5], 4);
    const flojo = calcularOnda([0, 0.02, 0, 0.01], 4);
    expect(fuerte).toEqual(flojo);
    expect(Math.max(...fuerte)).toBe(100);
  });

  it("el silencio da ceros de verdad, no un piso inventado", () => {
    expect(calcularOnda(new Float32Array(64), 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("toma el valor absoluto: la mitad negativa de la onda también cuenta", () => {
    expect(calcularOnda([-1, 0, 0, 0], 2)).toEqual([100, 0]);
  });

  it("todos los picos quedan entre 0 y 100 y son enteros", () => {
    const muestras = Array.from({ length: 5000 }, (_, i) => Math.sin(i / 7) * 0.83);
    for (const pico of calcularOnda(muestras)) {
      expect(Number.isInteger(pico)).toBe(true);
      expect(pico).toBeGreaterThanOrEqual(0);
      expect(pico).toBeLessThanOrEqual(100);
    }
  });

  it("con menos muestras que picos no deja huecos ni rompe", () => {
    expect(calcularOnda([1, 0.5], 6)).toHaveLength(6);
  });

  it("sin muestras devuelve una onda plana en vez de un arreglo vacío", () => {
    expect(calcularOnda(new Float32Array(0), 5)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("esOndaValida", () => {
  it("acepta lo que produce calcularOnda", () => {
    expect(esOndaValida(calcularOnda([1, 0.2, 0.7, 0]))).toBe(true);
  });

  it.each([
    ["vacía", []],
    ["con un pico mayor a 100", [10, 101]],
    ["con un pico negativo", [10, -1]],
    ["con decimales", [10, 4.5]],
    ["con algo que no es número", [10, "20"]],
    ["demasiado larga", Array.from({ length: 129 }, () => 1)],
    ["que no es un arreglo", { 0: 10 }],
  ])("rechaza una onda %s", (_caso, valor) => {
    expect(esOndaValida(valor)).toBe(false);
  });
});

describe("formatearDuracion", () => {
  it.each([
    [0, "0:00"],
    [7_000, "0:07"],
    [65_000, "1:05"],
    [600_000, "10:00"],
  ])("%i ms → %s", (ms, esperado) => {
    expect(formatearDuracion(ms)).toBe(esperado);
  });

  it("un valor imposible se muestra como cero, no como NaN", () => {
    expect(formatearDuracion(Number.NaN)).toBe("0:00");
    expect(formatearDuracion(-5)).toBe("0:00");
  });
});

describe("velocidades", () => {
  it("el ciclo empieza en 1 y SUBE antes de bajar", () => {
    expect(VELOCIDADES_DE_REPRODUCCION).toEqual([1, 1.5, 2, 0.75]);
  });

  it("da la vuelta completa y vuelve al principio", () => {
    let actual: number = 1;
    const recorrido = [actual];
    for (let i = 0; i < 4; i += 1) {
      actual = siguienteVelocidad(actual);
      recorrido.push(actual);
    }
    expect(recorrido).toEqual([1, 1.5, 2, 0.75, 1]);
  });

  it("desde un valor desconocido vuelve al principio del ciclo", () => {
    expect(siguienteVelocidad(3)).toBe(1);
  });

  it("la etiqueta usa coma decimal", () => {
    expect(etiquetaDeVelocidad(0.75)).toBe("0,75×");
    expect(etiquetaDeVelocidad(1.5)).toBe("1,5×");
    expect(etiquetaDeVelocidad(1)).toBe("1×");
    expect(etiquetaDeVelocidad(2)).toBe("2×");
  });
});

describe("tope de duración", () => {
  it("son cinco minutos, que es lo que dice el copy", () => {
    expect(MAX_DURACION_AUDIO_MS).toBe(5 * 60 * 1000);
    expect(formatearDuracion(MAX_DURACION_AUDIO_MS)).toBe("5:00");
  });
});
