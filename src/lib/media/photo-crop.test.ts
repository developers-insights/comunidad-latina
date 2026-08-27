import { describe, expect, it } from "vitest";
import {
  CROP_ASPECTS,
  FULL_CROP,
  MAX_CROP_ZOOM,
  aspectRatioOf,
  clampCropOffset,
  clampCropRect,
  clampCropScale,
  coverScaleFor,
  cropOutputSize,
  cropRectFrom,
  cropSourceRect,
  cropStageStateFrom,
  initialCropState,
  isFullCrop,
} from "./photo-crop";

/**
 * GEOMETRÍA DEL RECORTE — números de mano, sin DOM ni componente.
 *
 * Mismo criterio que `avatar-crop.test.ts` (de donde sale la mitad de estas
 * cuentas): lo que se prueba es que el rectángulo que se GUARDA describa
 * exactamente lo que la persona vio en el stage. Es la única garantía de que la
 * foto publicada tenga el encuadre que se aprobó, porque después del horneado
 * ya no hay vuelta atrás.
 */

const PAISAJE = { width: 4000, height: 3000 };
const RETRATO = { width: 3000, height: 4000 };

describe("aspectRatioOf — la forma que se pidió", () => {
  it("'original' es la de la propia foto, no una fija", () => {
    expect(aspectRatioOf("original", PAISAJE)).toBeCloseTo(4 / 3, 6);
    expect(aspectRatioOf("original", RETRATO)).toBeCloseTo(3 / 4, 6);
  });

  it("las fijas no miran la foto", () => {
    expect(aspectRatioOf("4:5", PAISAJE)).toBeCloseTo(0.8, 6);
    expect(aspectRatioOf("1:1", PAISAJE)).toBe(1);
    expect(aspectRatioOf("16:9", RETRATO)).toBeCloseTo(16 / 9, 6);
  });

  it("una foto con lados en 0 no rompe la cuenta", () => {
    expect(aspectRatioOf("original", { width: 0, height: 0 })).toBe(1);
  });

  it("4:5 está en el catálogo: es la forma de la tarjeta del feed", () => {
    expect(CROP_ASPECTS).toContain("4:5");
  });
});

describe("coverScaleFor — el zoom mínimo nunca deja un hueco", () => {
  it("un stage cuadrado sobre una foto apaisada se cubre por el ALTO", () => {
    // 400/3000 (alto) > 400/4000 (ancho): manda el lado que falta.
    expect(coverScaleFor(PAISAJE, { width: 400, height: 400 })).toBeCloseTo(400 / 3000, 6);
  });

  it("un stage apaisado sobre una foto vertical se cubre por el ANCHO", () => {
    expect(coverScaleFor(RETRATO, { width: 400, height: 225 })).toBeCloseTo(400 / 3000, 6);
  });

  it("con esa escala la foto mostrada nunca es más chica que el stage en ningún eje", () => {
    const stage = { width: 375, height: 469 };
    const scale = coverScaleFor(PAISAJE, stage);
    expect(PAISAJE.width * scale).toBeGreaterThanOrEqual(stage.width - 0.001);
    expect(PAISAJE.height * scale).toBeGreaterThanOrEqual(stage.height - 0.001);
  });
});

describe("clampCropScale — entre 'cubre' y el tope de acercamiento", () => {
  const stage = { width: 375, height: 469 };
  const min = coverScaleFor(PAISAJE, stage);

  it("no deja alejar por debajo del mínimo que cubre", () => {
    expect(clampCropScale(min / 10, PAISAJE, stage)).toBeCloseTo(min, 6);
  });

  it("no deja acercar más allá de MAX_CROP_ZOOM (publicar píxeles inventados)", () => {
    expect(clampCropScale(min * 100, PAISAJE, stage)).toBeCloseTo(min * MAX_CROP_ZOOM, 6);
  });

  it("un valor no numérico cae en el mínimo, no en NaN", () => {
    expect(clampCropScale(Number.NaN, PAISAJE, stage)).toBeCloseTo(min, 6);
  });
});

describe("clampCropOffset — el borde de la foto no puede entrar al encuadre", () => {
  const stage = { width: 400, height: 400 };

  it("al zoom mínimo, el eje que ya está justo no se puede mover", () => {
    const scale = coverScaleFor(PAISAJE, stage); // ajustado por ALTO
    const offset = clampCropOffset({ x: 9999, y: 9999 }, PAISAJE, scale, stage);
    expect(offset.y).toBe(0); // el alto está justo: no hay margen
    expect(offset.x).toBeGreaterThan(0); // el ancho sobra: sí hay margen
  });

  it("acercando aparece margen en los dos ejes", () => {
    const scale = coverScaleFor(PAISAJE, stage) * 2;
    const offset = clampCropOffset({ x: 9999, y: 9999 }, PAISAJE, scale, stage);
    expect(offset.x).toBeGreaterThan(0);
    expect(offset.y).toBeGreaterThan(0);
  });
});

describe("cropRectFrom — lo que se vio, en fracciones de la foto", () => {
  const stage = { width: 400, height: 400 };

  it("al zoom mínimo y centrado, toma la franja central del eje que sobra", () => {
    const scale = coverScaleFor(PAISAJE, stage);
    const rect = cropRectFrom({ natural: PAISAJE, stage, scale, offset: { x: 0, y: 0 } });

    // El alto entra completo; del ancho queda un cuadrado centrado.
    expect(rect.height).toBeCloseTo(1, 6);
    expect(rect.y).toBeCloseTo(0, 6);
    expect(rect.width).toBeCloseTo(3000 / 4000, 6);
    expect(rect.x).toBeCloseTo((1 - 3000 / 4000) / 2, 6);
  });

  it("arrastrar a la derecha corre el recorte hacia la IZQUIERDA de la foto", () => {
    const scale = coverScaleFor(PAISAJE, stage);
    const centrado = cropRectFrom({ natural: PAISAJE, stage, scale, offset: { x: 0, y: 0 } });
    const corrido = cropRectFrom({ natural: PAISAJE, stage, scale, offset: { x: 100, y: 0 } });
    expect(corrido.x).toBeLessThan(centrado.x);
  });

  it("acercar achica la porción tomada", () => {
    const base = coverScaleFor(PAISAJE, stage);
    const cerca = cropRectFrom({
      natural: PAISAJE,
      stage,
      scale: base * 2,
      offset: { x: 0, y: 0 },
    });
    expect(cerca.width).toBeCloseTo(3000 / 4000 / 2, 6);
    expect(cerca.height).toBeCloseTo(0.5, 6);
  });

  it("nunca devuelve un rect que se salga de la foto", () => {
    const rect = cropRectFrom({
      natural: PAISAJE,
      stage,
      scale: 0.0001, // absurdo: pediría más foto de la que hay
      offset: { x: 0, y: 0 },
    });
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1.000001);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1.000001);
  });

  it("una escala imposible devuelve la foto entera en vez de romperse", () => {
    expect(cropRectFrom({ natural: PAISAJE, stage, scale: 0, offset: { x: 0, y: 0 } })).toEqual(
      FULL_CROP,
    );
  });
});

describe("cropStageStateFrom — la vuelta: reabrir el editor en el mismo encuadre", () => {
  const stage = { width: 400, height: 500 };

  it("ida y vuelta conservan el recorte (si no, retocar sería empezar de cero)", () => {
    const scale = coverScaleFor(RETRATO, stage) * 1.7;
    const offset = { x: 24, y: -40 };
    const rect = cropRectFrom({ natural: RETRATO, stage, scale, offset });

    const vuelta = cropStageStateFrom(rect, RETRATO, stage);
    expect(vuelta.scale).toBeCloseTo(scale, 4);
    expect(vuelta.offset.x).toBeCloseTo(offset.x, 3);
    expect(vuelta.offset.y).toBeCloseTo(offset.y, 3);
  });

  it("un rect vacío o corrupto vuelve al encuadre inicial en vez de a NaN", () => {
    const inicial = initialCropState(RETRATO, stage);
    const roto = cropStageStateFrom({ x: 0, y: 0, width: 0, height: 0 }, RETRATO, stage);
    expect(roto.scale).toBeCloseTo(inicial.scale, 6);
    expect(roto.offset).toEqual(inicial.offset);
  });
});

describe("isFullCrop / clampCropRect", () => {
  it("la foto entera es 'sin recorte'", () => {
    expect(isFullCrop(FULL_CROP)).toBe(true);
    expect(isFullCrop(null)).toBe(true);
    expect(isFullCrop(undefined)).toBe(true);
  });

  it("tolera el ruido del punto flotante — no marca 'recortada' una foto que nadie tocó", () => {
    expect(isFullCrop({ x: 1e-9, y: 0, width: 0.9999999, height: 1 })).toBe(true);
  });

  it("un recorte de verdad no pasa por entero", () => {
    expect(isFullCrop({ x: 0, y: 0.1, width: 1, height: 0.8 })).toBe(false);
  });

  it("clampCropRect empuja el rect adentro en vez de recortar el ancho", () => {
    // Si en vez de mover el origen se achicara el ancho, la foto cambiaría de
    // forma sola al llegar al borde.
    const rect = clampCropRect({ x: 0.9, y: 0, width: 0.5, height: 1 });
    expect(rect.width).toBeCloseTo(0.5, 6);
    expect(rect.x).toBeCloseTo(0.5, 6);
  });
});

describe("cropSourceRect / cropOutputSize — lo que recibe el canvas", () => {
  it("traduce fracciones a píxeles de la foto", () => {
    expect(cropSourceRect(PAISAJE, { x: 0.25, y: 0.5, width: 0.5, height: 0.25 })).toEqual({
      sx: 1000,
      sy: 1500,
      sw: 2000,
      sh: 750,
    });
  });

  it("nunca devuelve un lado en 0: un drawImage de ancho 0 no dibuja y no avisa", () => {
    const rect = cropSourceRect(PAISAJE, { x: 0, y: 0, width: 0, height: 0 });
    expect(rect.sw).toBeGreaterThan(0);
    expect(rect.sh).toBeGreaterThan(0);
  });

  it("el tamaño de salida respeta el tope del lado largo", () => {
    expect(cropOutputSize(PAISAJE, FULL_CROP, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("y NUNCA agranda: recortar poquito no puede devolver un archivo más pesado", () => {
    expect(cropOutputSize(PAISAJE, { x: 0.4, y: 0.4, width: 0.1, height: 0.1 }, 1600)).toEqual({
      width: 400,
      height: 300,
    });
  });

  it("conserva la forma del recorte, no la de la foto", () => {
    const size = cropOutputSize(PAISAJE, { x: 0, y: 0.25, width: 1, height: 0.5 }, 1600);
    expect(size.width / size.height).toBeCloseTo(4000 / 1500, 2);
  });
});
