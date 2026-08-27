/**
 * RECORTE DE UNA FOTO — geometría pura (pedido del cliente 2026-08-26: "para
 * publicar una foto falta el editor · medio que sería un crop para las fotos").
 *
 * ─── POR QUÉ NO SE TRAJO UNA LIBRERÍA ───────────────────────────────────────
 * El repo ya recorta fotos: `avatar-crop.ts` resuelve el encuadre CIRCULAR del
 * avatar con tres funciones puras —escala mínima que cubre, offset recortado,
 * rectángulo de dibujo— y su componente arrastra con el dedo sobre un stage.
 * Lo único que le falta a ese modelo para servir acá es que el stage deje de
 * ser cuadrado. Así que esto es esa misma geometría GENERALIZADA a un stage
 * rectangular, y `clampOffsetAxis` se IMPORTA de allá en vez de reescribirse:
 * ya trabaja por eje, que es exactamente lo que hace falta.
 *
 * ─── QUÉ SE GUARDA, Y POR QUÉ ASÍ ───────────────────────────────────────────
 * Lo que viaja hasta el horneado es un {@link CropRect} NORMALIZADO (0–1 sobre
 * la foto original), no un scale/offset en píxeles de pantalla. Tres motivos:
 *
 *  · El stage mide distinto en cada teléfono. Un offset en píxeles de un iPhone
 *    SE encuadra otra cosa en un Pixel: el recorte quedaría atado al ancho de
 *    la pantalla donde se editó.
 *  · `bake-photo.ts` necesita un rectángulo de la FUENTE para `drawImage`, que
 *    es literalmente esto multiplicado por el tamaño natural.
 *  · Es la forma que se puede probar con números de mano, sin montar un
 *    componente ni simular un `pointerdown`.
 *
 * La ida y la vuelta están las dos: {@link cropRectFrom} arma el rect desde lo
 * que la persona arrastró, {@link cropStageStateFrom} lo devuelve a scale/offset
 * para volver a abrir el editor en el mismo encuadre.
 */

import { clampOffsetAxis, type CropOffset, type Size } from "./avatar-crop";

export type { CropOffset, Size };

// ---------------------------------------------------------------------------
// Las relaciones que se ofrecen
// ---------------------------------------------------------------------------

/**
 * `original` no es una relación: es "la que ya tiene la foto". Se resuelve
 * contra el tamaño natural en {@link aspectRatioOf}.
 */
export const CROP_ASPECTS = ["original", "4:5", "1:1", "16:9"] as const;

export type CropAspectId = (typeof CROP_ASPECTS)[number];

export const DEFAULT_CROP_ASPECT: CropAspectId = "original";

/**
 * 4:5 primero entre las fijas porque ES la forma de la tarjeta del feed
 * (`CardMedia aspect="portrait"` → `aspect-[4/5]`). Una foto recortada a 4:5 se
 * ve en la card exactamente como se vio acá; cualquier otra la muestra el
 * navegador con `object-cover`, o sea recortando de nuevo por su cuenta.
 */
const FIXED_RATIOS: Record<Exclude<CropAspectId, "original">, number> = {
  "4:5": 4 / 5,
  "1:1": 1,
  "16:9": 16 / 9,
};

/** Ancho/alto de la relación pedida. `original` mira la foto. */
export function aspectRatioOf(aspect: CropAspectId, natural: Size): number {
  if (aspect !== "original") return FIXED_RATIOS[aspect];
  if (natural.width <= 0 || natural.height <= 0) return 1;
  return natural.width / natural.height;
}

// ---------------------------------------------------------------------------
// El rectángulo recortado
// ---------------------------------------------------------------------------

/**
 * Porción de la foto que queda publicada, en fracciones de 0 a 1 sobre la foto
 * ORIGINAL. `{x:0, y:0, width:1, height:1}` es la foto entera.
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** La foto entera, sin recortar. */
export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/**
 * ¿Este recorte deja la foto tal cual? Se usa para no gastar un `drawImage`
 * con rectángulo de fuente cuando no hay nada que recortar, y para saber si el
 * chip "Original" tiene que mostrarse activo.
 *
 * Con tolerancia porque el rect sale de una división en punto flotante: pedir
 * igualdad exacta contra 1 marcaría como "recortada" una foto que nadie tocó.
 */
export function isFullCrop(crop: CropRect | null | undefined): boolean {
  if (!crop) return true;
  /**
   * La tolerancia no es cosmética. El stage sale de un `aspect-ratio` de CSS y
   * se mide con `getBoundingClientRect`, que devuelve subpíxeles: con la
   * relación "Original" el encuadre que cubre exactamente el stage da 0,9998 en
   * vez de 1. Con igualdad estricta, ABRIR el editor y tocar "Listo" sin mover
   * nada marcaría la foto como recortada. 0,002 sobre una foto de 4000 px son
   * 8 px de nada, muy por debajo de lo que alguien encuadra a propósito.
   */
  const e = 0.002;
  return (
    Math.abs(crop.x) < e &&
    Math.abs(crop.y) < e &&
    Math.abs(crop.width - 1) < e &&
    Math.abs(crop.height - 1) < e
  );
}

/** Deja el rect dentro de la foto: nunca se puede publicar lo que no existe. */
export function clampCropRect(crop: CropRect): CropRect {
  const width = Math.min(1, Math.max(0, crop.width || 0));
  const height = Math.min(1, Math.max(0, crop.height || 0));
  return {
    width,
    height,
    x: Math.min(1 - width, Math.max(0, crop.x || 0)),
    y: Math.min(1 - height, Math.max(0, crop.y || 0)),
  };
}

// ---------------------------------------------------------------------------
// El stage: lo que la persona ve y arrastra
// ---------------------------------------------------------------------------

/**
 * Escala mínima para que la foto CUBRA el stage rectangular — el zoom "1×". Es
 * `coverScale` de avatar-crop generalizado: con un stage cuadrado devuelve
 * exactamente lo mismo, porque ahí los dos ejes piden el mismo número.
 *
 * Con esta escala nunca queda un hueco vacío dentro del encuadre, que es la
 * única garantía que importa: publicar una foto con una banda transparente
 * porque alguien alejó de más no es una opción.
 */
export function coverScaleFor(natural: Size, stage: Size): number {
  if (natural.width <= 0 || natural.height <= 0) return 1;
  if (stage.width <= 0 || stage.height <= 0) return 1;
  return Math.max(stage.width / natural.width, stage.height / natural.height);
}

/** Tope de acercamiento. Más que esto es publicar píxeles inventados. */
export const MAX_CROP_ZOOM = 4;

/** Deja el zoom entre "cubre el stage" y {@link MAX_CROP_ZOOM} veces eso. */
export function clampCropScale(scale: number, natural: Size, stage: Size): number {
  const min = coverScaleFor(natural, stage);
  if (!Number.isFinite(scale)) return min;
  return Math.min(min * MAX_CROP_ZOOM, Math.max(min, scale));
}

/** `clampOffsetAxis` (avatar-crop) en los dos ejes de un stage rectangular. */
export function clampCropOffset(
  offset: CropOffset,
  natural: Size,
  scale: number,
  stage: Size,
): CropOffset {
  return {
    x: clampOffsetAxis(offset.x, natural.width, scale, stage.width),
    y: clampOffsetAxis(offset.y, natural.height, scale, stage.height),
  };
}

export interface CropStageState {
  scale: number;
  offset: CropOffset;
}

/**
 * Encuadre inicial de un stage: la foto centrada, al zoom mínimo que lo cubre.
 * Es lo que se ve al abrir el recorte o al cambiar de relación.
 */
export function initialCropState(natural: Size, stage: Size): CropStageState {
  return { scale: coverScaleFor(natural, stage), offset: { x: 0, y: 0 } };
}

// ---------------------------------------------------------------------------
// Stage ⇄ rect normalizado
// ---------------------------------------------------------------------------

/**
 * Lo que la persona encuadró, convertido a fracciones de la foto original.
 *
 * La cuenta: el stage muestra `stage.width / scale` píxeles de la foto; el
 * `offset` corre la foto respecto del centro del stage, así que el borde
 * izquierdo del recorte está a `centro - mitad del ancho visible - offset`.
 * Todo dividido por el tamaño natural para que el resultado no dependa de
 * cuántos píxeles medía el stage en ESE teléfono.
 */
export function cropRectFrom(args: {
  natural: Size;
  stage: Size;
  scale: number;
  offset: CropOffset;
}): CropRect {
  const { natural, stage, scale, offset } = args;
  if (natural.width <= 0 || natural.height <= 0 || scale <= 0) return FULL_CROP;

  const visibleWidth = stage.width / scale;
  const visibleHeight = stage.height / scale;

  const rect = clampCropRect({
    x: (natural.width / 2 - visibleWidth / 2 - offset.x / scale) / natural.width,
    y: (natural.height / 2 - visibleHeight / 2 - offset.y / scale) / natural.height,
    width: visibleWidth / natural.width,
    height: visibleHeight / natural.height,
  });
  // "Casi entera" ES entera: se devuelve el rect exacto para que todo lo que
  // pregunte después (`isFullCrop`, el horneado, la miniatura) vea el mismo
  // valor y no una versión con ruido de subpíxel (ver la tolerancia arriba).
  return isFullCrop(rect) ? FULL_CROP : rect;
}

/**
 * La vuelta: del rect guardado al scale/offset con el que se dibuja el stage.
 * Sin esto, reabrir el editor de una foto ya recortada la mostraría entera otra
 * vez —o peor, aplicaría el recorte dos veces— y no habría forma de retocarlo.
 */
export function cropStageStateFrom(
  crop: CropRect,
  natural: Size,
  stage: Size,
): CropStageState {
  const safe = clampCropRect(crop);
  if (natural.width <= 0 || natural.height <= 0 || safe.width <= 0 || safe.height <= 0) {
    return initialCropState(natural, stage);
  }
  const scale = stage.width / (safe.width * natural.width);
  const centerX = (safe.x + safe.width / 2) * natural.width;
  const centerY = (safe.y + safe.height / 2) * natural.height;
  return {
    scale,
    offset: {
      x: (natural.width / 2 - centerX) * scale,
      y: (natural.height / 2 - centerY) * scale,
    },
  };
}

// ---------------------------------------------------------------------------
// Lo que necesita el canvas
// ---------------------------------------------------------------------------

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Rect de FUENTE para `ctx.drawImage(img, sx, sy, sw, sh, …)`, en píxeles. */
export function cropSourceRect(natural: Size, crop: CropRect): SourceRect {
  const safe = clampCropRect(crop);
  return {
    sx: Math.round(safe.x * natural.width),
    sy: Math.round(safe.y * natural.height),
    // Nunca 0: un `drawImage` con ancho 0 no dibuja nada y no avisa.
    sw: Math.max(1, Math.round(safe.width * natural.width)),
    sh: Math.max(1, Math.round(safe.height * natural.height)),
  };
}

/**
 * Tamaño del canvas de salida para este recorte, con el lado largo topado.
 * Nunca AGRANDA: recortar una porción chiquita de una foto chica no puede
 * devolver un archivo más pesado que el original interpolando píxeles.
 */
export function cropOutputSize(natural: Size, crop: CropRect, maxLongSide: number): Size {
  const { sw, sh } = cropSourceRect(natural, crop);
  const scale = Math.min(1, maxLongSide / Math.max(sw, sh));
  return {
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  };
}
