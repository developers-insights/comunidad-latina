import { describe, expect, it } from "vitest";
import {
  LUMA_SIZE,
  PHASH_BITS,
  VIDEO_PHASH_BITS,
  hammingDistance,
  isBitString,
  phash64,
  readBitString,
  videoPhash256,
} from "./phash";
import { sha256Hex, toByteaLiteral, byteaToHex } from "./hash";
import { DEFAULT_MAX_DISTANCE } from "./scan";

/**
 * El corazón de Content Integrity, probado donde es puro.
 *
 * Las dos garantías que el pliego pide se prueban ACÁ y no contra la base:
 *   · duplicado EXACTO  → el SHA-256 de los mismos bytes es el mismo, y el de
 *     un byte cambiado es completamente distinto;
 *   · COINCIDENCIA SIMILAR → la huella perceptual de una imagen recomprimida
 *     queda por DEBAJO del umbral, y la de una imagen distinta muy por encima.
 *
 * Un test que necesitara Supabase para probar esto estaría probando Supabase.
 */

const N = LUMA_SIZE;

/** Generador determinístico: los tests no pueden depender de Math.random(). */
function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Una "foto": degradé diagonal con un bloque claro arriba a la izquierda. */
function baseImage(): number[] {
  const luma: number[] = [];
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const gradient = ((x + y) / (2 * N)) * 200;
      const block = x < N / 3 && y < N / 3 ? 55 : 0;
      luma.push(Math.round(gradient + block));
    }
  }
  return luma;
}

/** Una foto DISTINTA: franjas verticales. No se parece en nada a la anterior. */
function otherImage(): number[] {
  const luma: number[] = [];
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      luma.push(Math.floor(x / 4) % 2 === 0 ? 30 : 220);
    }
  }
  return luma;
}

/** Recompresión simulada: ruido acotado, como el que deja un JPEG de baja calidad. */
function recompressed(source: number[], amplitude = 12): number[] {
  const random = pseudoRandom(7);
  return source.map((value) =>
    Math.max(0, Math.min(255, Math.round(value + (random() - 0.5) * amplitude))),
  );
}

/** Cambio de brillo/contraste: la misma foto "levantada". */
function brightened(source: number[]): number[] {
  return source.map((value) => Math.max(0, Math.min(255, Math.round(value * 0.9 + 20))));
}

describe("duplicado EXACTO — SHA-256", () => {
  it("los mismos bytes dan la misma huella", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(sha256Hex(bytes)).toBe(sha256Hex(new Uint8Array([1, 2, 3, 4, 5])));
  });

  it("un solo byte distinto cambia la huella por completo", () => {
    const a = sha256Hex(new Uint8Array([1, 2, 3, 4, 5]));
    const b = sha256Hex(new Uint8Array([1, 2, 3, 4, 6]));
    expect(b).not.toBe(a);
    // No es "parecida": es otra. El SHA-256 no tiene noción de cercanía, y ese
    // es exactamente el motivo por el que hace falta la huella perceptual.
    expect(hammingDistance(a, b)).toBeGreaterThan(0);
  });

  it("va y vuelve del formato bytea que habla PostgREST", () => {
    const hex = sha256Hex(new Uint8Array([9, 9, 9]));
    expect(toByteaLiteral(hex)).toBe(`\\x${hex}`);
    expect(byteaToHex(toByteaLiteral(hex))).toBe(hex);
    expect(byteaToHex("no es hex")).toBeNull();
    expect(byteaToHex(null)).toBeNull();
  });
});

describe("coincidencia SIMILAR — huella perceptual", () => {
  const base = phash64(baseImage());

  it("la huella tiene el ancho de la columna bit(64)", () => {
    expect(base).toHaveLength(PHASH_BITS);
    expect(isBitString(base, PHASH_BITS)).toBe(true);
  });

  it("la misma imagen da exactamente la misma huella", () => {
    expect(phash64(baseImage())).toBe(base);
  });

  it("NEAR-DUPLICATE: una imagen recomprimida queda por debajo del umbral", () => {
    const distance = hammingDistance(base, phash64(recompressed(baseImage())));
    expect(distance).toBeLessThanOrEqual(DEFAULT_MAX_DISTANCE);
  });

  it("NEAR-DUPLICATE: un cambio de brillo y contraste tampoco la despega", () => {
    const distance = hammingDistance(base, phash64(brightened(baseImage())));
    expect(distance).toBeLessThanOrEqual(DEFAULT_MAX_DISTANCE);
  });

  it("una imagen DISTINTA queda muy por encima del umbral", () => {
    const distance = hammingDistance(base, phash64(otherImage()));
    expect(distance).toBeGreaterThan(DEFAULT_MAX_DISTANCE);
  });

  it("el bit del coeficiente DC es constante (no aporta información)", () => {
    expect(base[0]).toBe("0");
    expect(phash64(otherImage())[0]).toBe("0");
  });

  it("una matriz del tamaño equivocado es un bug, no una huella rara", () => {
    expect(() => phash64([1, 2, 3])).toThrow(RangeError);
  });

  it("comparar huellas de distinto ancho también es un bug", () => {
    expect(() => hammingDistance("0101", "01")).toThrow(RangeError);
  });
});

describe("huella de video", () => {
  it("tiene el ancho de la columna bit(256) aunque lleguen menos fotogramas", () => {
    const single = videoPhash256([baseImage()]);
    expect(single).toHaveLength(VIDEO_PHASH_BITS);
    // Con un solo fotograma se repite el último: los cuatro bloques son iguales.
    expect(single?.slice(0, 64)).toBe(single?.slice(64, 128));
  });

  it("sin fotogramas devuelve null — que significa 'no se analizó'", () => {
    expect(videoPhash256([])).toBeNull();
  });

  it("dos videos con fotogramas parecidos quedan cerca", () => {
    const a = videoPhash256([baseImage(), baseImage(), baseImage(), baseImage()]);
    const b = videoPhash256([
      recompressed(baseImage()),
      recompressed(baseImage()),
      recompressed(baseImage()),
      recompressed(baseImage()),
    ]);
    expect(hammingDistance(a!, b!)).toBeLessThanOrEqual(DEFAULT_MAX_DISTANCE * 4);
  });
});

describe("lectura de columnas bit(N) de PostgREST", () => {
  it("acepta una cadena de bits del ancho exacto y rechaza el resto", () => {
    const bits = "1".repeat(PHASH_BITS);
    expect(readBitString(bits, PHASH_BITS)).toBe(bits);
    expect(readBitString(bits, VIDEO_PHASH_BITS)).toBeNull();
    expect(readBitString(null, PHASH_BITS)).toBeNull();
    expect(readBitString("12", 2)).toBeNull();
  });
});
