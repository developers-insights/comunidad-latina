/**
 * Geometría pura del encuadre circular del avatar.
 *
 * Separado de `avatar-upload-field.tsx` (que es `"use client"`, tiene DOM y
 * puntero) para poder probar las cuentas con números de mano, sin montar un
 * componente ni simular eventos de arrastre — mismo criterio que
 * `photo-filters.ts` en esta misma carpeta.
 *
 * ── EL MISMO NÚMERO, DOS VECES ───────────────────────────────────────────────
 * El "stage" es el círculo que la persona ve y arrastra en pantalla (tamaño
 * fijo en CSS px). El "output" es el canvas cuadrado que se hornea y se sube.
 * Son la MISMA escena en dos escalas distintas — por eso `outputDrawRect`
 * reescala el mismo `scale`/`offset` del stage por la razón `outputSize /
 * stageSize` en vez de recibir una cuenta aparte: lo que la persona ve es
 * literalmente lo que se guarda (WYSIWYG), nunca una aproximación.
 */

export interface Size {
  width: number;
  height: number;
}

export interface CropOffset {
  x: number;
  y: number;
}

/**
 * Escala mínima para que la imagen CUBRA el stage cuadrado: su lado más corto
 * queda exactamente del tamaño del stage. Es el zoom "1×", el punto de
 * partida — con esta escala nunca queda un hueco vacío dentro del círculo.
 */
export function coverScale(natural: Size, stageSize: number): number {
  const shortSide = Math.min(natural.width, natural.height);
  if (shortSide <= 0 || stageSize <= 0) return 1;
  return stageSize / shortSide;
}

/**
 * Recorta un offset (un solo eje) para que la imagen nunca deje un hueco
 * dentro del stage: el borde de la imagen no puede cruzar el centro. Si la
 * imagen mostrada mide lo mismo que el stage (zoom mínimo en ese eje), el
 * único offset válido es 0 — centrado, sin margen para arrastrar.
 */
export function clampOffsetAxis(
  offset: number,
  naturalSize: number,
  scale: number,
  stageSize: number,
): number {
  const displayed = naturalSize * scale;
  const max = Math.max(0, (displayed - stageSize) / 2);
  if (max === 0) return 0;
  return Math.min(max, Math.max(-max, offset));
}

/** `clampOffsetAxis` en los dos ejes a la vez. */
export function clampOffset(
  offset: CropOffset,
  natural: Size,
  scale: number,
  stageSize: number,
): CropOffset {
  return {
    x: clampOffsetAxis(offset.x, natural.width, scale, stageSize),
    y: clampOffsetAxis(offset.y, natural.height, scale, stageSize),
  };
}

export interface DrawRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Rectángulo para `ctx.drawImage(img, dx, dy, dw, dh)`: dibuja la imagen
 * ENTERA (sin recortar la fuente) escalada y desplazada — lo que quede fuera
 * de `[0, outputSize]` lo recorta el propio canvas, igual que el
 * `overflow-hidden` recorta el stage en pantalla. Mismo encuadre, dos
 * mecanismos de recorte distintos por eso mismo consistentes entre sí.
 */
export function outputDrawRect(args: {
  natural: Size;
  scale: number;
  offset: CropOffset;
  stageSize: number;
  outputSize: number;
}): DrawRect {
  const { natural, scale, offset, stageSize, outputSize } = args;
  const ratio = outputSize / stageSize;
  const dw = natural.width * scale * ratio;
  const dh = natural.height * scale * ratio;
  return {
    dw,
    dh,
    dx: (outputSize - dw) / 2 + offset.x * ratio,
    dy: (outputSize - dh) / 2 + offset.y * ratio,
  };
}
