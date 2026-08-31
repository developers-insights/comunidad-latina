/**
 * HORNEAR UNA FOTO — quemar el RECORTE, el filtro, el texto y los emojis en los
 * píxeles, en el propio navegador, ANTES de que el archivo viaje en el
 * `FormData` de siempre.
 *
 * POR QUÉ ACÁ Y NO EN EL SERVIDOR: `createPostAction` (no es nuestro, no se
 * toca) recibe `photos` como `File` dentro del `FormData` que ya arma
 * `post-composer.tsx` — no tiene ni idea de "filtro" ni de "texto sobre la
 * foto", y no hace falta que se entere. Si el archivo que le mandamos YA
 * tiene el filtro y el texto quemados encima, el contrato no cambia una
 * coma: sigue siendo una foto más, del mismo tipo que sube hoy.
 *
 * TAMBIÉN RESUELVE EL PESO. Con el tope subido a 10 fotos, 10 × 5 MB por una
 * server action es demasiado — por eso este módulo SIEMPRE recomprime a JPEG
 * (calidad ~0.85) y limita el lado largo a `MAX_LONG_SIDE`, aunque la persona
 * no haya tocado ni el filtro ni el texto. El horneado es la oportunidad y no
 * hay que dejarla pasar: `post-composer.tsx` llama a `bakePhoto` para CADA
 * foto al publicar, con `filterCss` vacío y sin `caption` si nunca se abrió
 * el editor.
 *
 * EL ORDEN DE DIBUJO NO ES NEGOCIABLE, y es el mismo que ve la persona en la
 * vista previa: (1) recorte, (2) filtro sobre la foto, (3) texto, (4) emojis.
 * El recorte define el RECUADRO contra el que se posicionan el texto y los
 * emojis —las dos cosas se guardan en fracciones de ese recuadro, no de la
 * foto cruda—, y el filtro se apaga antes del texto porque un Carbón al 100%
 * también dejaría gris una frase que se eligió amarilla.
 *
 * SI ALGO FALLA (el navegador no soporta `ctx.filter`, `canvas.toBlob`
 * devuelve `null`, la imagen no se puede decodificar…) la función devuelve el
 * ARCHIVO ORIGINAL, tal cual se eligió, y el error queda logueado — nunca un
 * `catch {}` mudo. Quien llama decide cómo avisar (acá, un toast); lo que
 * nunca pasa es que un efecto decorativo le impida a alguien publicar.
 */

import {
  DEFAULT_CAPTION_COLOR,
  DEFAULT_CAPTION_FONT,
  STICKER_FONT_FAMILY,
  captionBarFill,
  captionFontShorthand,
  captionHaloColor,
  normalizeStickers,
  resolveCaptionColor,
  resolveCaptionFont,
  stickerBox,
  type CaptionColorId,
  type CaptionFontId,
  type PhotoSticker,
} from "./photo-overlay";
import {
  FULL_CROP,
  cropOutputSize,
  cropSourceRect,
  isFullCrop,
  type CropRect,
} from "./photo-crop";

export const MAX_LONG_SIDE = 1600;
export const JPEG_QUALITY = 0.85;
/** Tope de caracteres del texto sobre la foto — una frase corta, no un párrafo. */
export const CAPTION_MAX_LENGTH = 80;

export type CaptionPosition = "top" | "center" | "bottom";
export type CaptionBackground = "solid" | "none";

export interface PhotoCaption {
  text: string;
  position: CaptionPosition;
  background: CaptionBackground;
  /** Tinta. Ausente = blanco, que es lo que se quemaba antes de la paleta. */
  color?: CaptionColorId;
  /** Familia. Ausente = la de interfaz, que es la que se quemaba antes. */
  font?: CaptionFontId;
}

export interface BakePhotoOptions {
  /** Valor de `filter` (CSS/canvas). Vacío o `undefined` = sin filtro. */
  filterCss?: string;
  /**
   * ENCUADRE, en fracciones de la foto original (ver photo-crop.ts). Ausente o
   * `FULL_CROP` = la foto entera, que es como venía funcionando esto.
   *
   * Va PRIMERO en el orden de dibujo, y tiene que ser así: el texto y los
   * emojis se colocan contra el recuadro PUBLICADO, no contra la foto cruda.
   * Si se recortara después, un texto centrado dejaría de estar centrado.
   */
  crop?: CropRect | null;
  /** Texto sobre la foto. `undefined` o `text` vacío = no se dibuja nada. */
  caption?: PhotoCaption | null;
  /**
   * Emojis pegados sobre la foto. Se dibujan ARRIBA del texto: quien los puso
   * los vio arriba en la vista previa.
   */
  stickers?: readonly PhotoSticker[] | null;
  /** Lado largo máximo, en px. Nunca agranda una foto más chica. */
  maxLongSide?: number;
  /** Calidad JPEG (0–1). */
  quality?: number;
  /**
   * Se llama SOLO si el horneado no se pudo completar y se devolvió el
   * archivo original. No sustituye al log de consola — es para que quien
   * llama avise (toast); el motivo ya quedó en `console.error`.
   */
  onFallback?: (reason: string) => void;
  /**
   * La foto SÍ se horneó, pero la tipografía elegida no estaba disponible y el
   * texto salió con la de respaldo.
   *
   * Existe porque el modo de fallar de una fuente en canvas es SILENCIOSO:
   * `ctx.font` con una familia que todavía no cargó no tira ningún error, no
   * devuelve `false`, simplemente dibuja con otra letra. Sin este aviso, elegir
   * "Clásica" y recibir "Redonda" sería un cambio invisible sobre un archivo
   * que ya no se puede deshacer. Es una NOTA, no un fracaso: la foto se publica
   * igual (ver `ensureCaptionFont`).
   */
  onFontFallback?: (fontLabel: string) => void;
}

/** Quema filtro + texto en `file` y devuelve un JPEG liviano. Nunca lanza. */
export async function bakePhoto(file: File, options: BakePhotoOptions = {}): Promise<File> {
  const {
    filterCss = "",
    crop,
    caption,
    stickers,
    maxLongSide = MAX_LONG_SIDE,
    quality = JPEG_QUALITY,
    onFallback,
    onFontFallback,
  } = options;

  if (typeof document === "undefined") return file;

  let cleanup: (() => void) | null = null;
  try {
    const source = await loadSource(file);
    cleanup = source.cleanup;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo obtener el contexto 2D del canvas");

    // El filtro es decorativo: si se pidió uno y el navegador no lo soporta,
    // ni vale la pena hornear "a medias" — se avisa y se publica el original.
    const supportsFilter = "filter" in ctx;
    if (filterCss && !supportsFilter) {
      throw new Error("El navegador no soporta filtros de canvas (CanvasRenderingContext2D.filter)");
    }

    /**
     * (1) EL RECUADRO PUBLICADO. Sin recorte es la foto entera escalada, que es
     * exactamente la cuenta de siempre —`cropOutputSize` con `FULL_CROP` da el
     * mismo número—; con recorte, el canvas ya tiene la forma final y todo lo
     * que se dibuje encima se posiciona contra ELLA.
     */
    const natural = { width: source.width, height: source.height };
    const safeCrop = crop && !isFullCrop(crop) ? crop : FULL_CROP;
    const output = cropOutputSize(natural, safeCrop, maxLongSide);
    const targetWidth = output.width;
    const targetHeight = output.height;
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    // (2) La foto, recortada y filtrada. La versión de `drawImage` con
    // rectángulo de FUENTE es la que recorta; con `FULL_CROP` toma la imagen
    // completa y el resultado es idéntico al de antes.
    const { sx, sy, sw, sh } = cropSourceRect(natural, safeCrop);
    ctx.filter = filterCss && supportsFilter ? filterCss : "none";
    ctx.drawImage(source.draw, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
    ctx.filter = "none"; // lo de arriba nunca lleva el filtro de la foto

    // (3) El texto. La fuente se ESPERA antes de medir una sola letra: `ctx.font`
    // con una familia que todavía no cargó no falla, dibuja con otra (ver
    // `ensureCaptionFont`), y el ajuste de línea se calcularía con anchos que no
    // son los del archivo final.
    const captionText = caption?.text.trim();
    if (caption && captionText) {
      const font = resolveCaptionFont(caption.font ?? DEFAULT_CAPTION_FONT);
      const fontSize = captionFontSizeFor(targetWidth);
      const available = await ensureCaptionFont(caption.font ?? DEFAULT_CAPTION_FONT, fontSize);
      if (!available) onFontFallback?.(font.label);
      drawCaption(ctx, targetWidth, targetHeight, { ...caption, text: captionText }, fontSize);
    }

    // (4) Los emojis, arriba de todo: es donde se los vio al ponerlos.
    drawStickers(ctx, targetWidth, targetHeight, normalizeStickers(stickers));

    const blob = await canvasToBlob(canvas, quality);
    return new File([blob], deriveFileName(file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[bake-photo] no se pudo procesar la foto, se publica el original:", reason);
    onFallback?.(reason);
    return file;
  } finally {
    cleanup?.();
  }
}

// ---------------------------------------------------------------------------
// Carga de la fuente — respeta la orientación EXIF
// ---------------------------------------------------------------------------

interface ImageSource {
  draw: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

/**
 * `createImageBitmap` con `imageOrientation: "from-image"` (soportado por los
 * navegadores evergreen) es el camino correcto para NO reinventar la
 * corrección de orientación EXIF a mano. Si no está disponible o falla para
 * este archivo puntual, cae a un `<img>` de toda la vida — degradado, no roto.
 */
async function loadSource(file: File): Promise<ImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        draw: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fallback abajo: algún navegador no soporta la opción para este
      // formato puntual. No es un error fatal todavía.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo decodificar la imagen"));
      img.src = objectUrl;
    });
    return {
      draw: loaded,
      width: loaded.naturalWidth,
      height: loaded.naturalHeight,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob devolvió null"))),
      "image/jpeg",
      quality,
    );
  });
}

function deriveFileName(original: string): string {
  const withoutExtension = original.replace(/\.[^/.]+$/, "");
  return `${withoutExtension || "foto"}.jpg`;
}

// ---------------------------------------------------------------------------
// Texto sobre la foto — mismo cálculo que la vista previa (WYSIWYG real)
// ---------------------------------------------------------------------------

const MAX_CAPTION_LINES = 4;

/**
 * Cuerpo del texto para un recuadro de este ancho. Vive aparte porque lo
 * necesitan DOS momentos distintos —esperar la fuente y dibujarla— y calcularlo
 * dos veces con la misma fórmula copiada es cómo se llega a que la fuente que
 * se precargó no sea exactamente la que se pide después.
 */
export function captionFontSizeFor(canvasWidth: number): number {
  return clamp(Math.round(canvasWidth / 16), 22, 64);
}

/**
 * ¿Está la tipografía elegida LISTA PARA DIBUJAR en el canvas?
 *
 * Ésta es la trampa central de hornear texto: `ctx.font = "700 40px MiFuente"`
 * no espera nada ni avisa nada. Si la familia todavía no se descargó, el canvas
 * dibuja con la de respaldo y el archivo queda publicado con otra letra —
 * silenciosamente, e irreversible. `document.fonts.load()` fuerza la carga y
 * `check()` confirma que ya se puede usar.
 *
 * Devuelve `false` en vez de lanzar: quedarse sin publicar por una tipografía
 * sería peor que publicar con la de respaldo. Quien llama lo cuenta
 * (`onFontFallback`), que es lo que convierte un cambio invisible en un aviso.
 */
async function ensureCaptionFont(id: CaptionFontId, sizePx: number): Promise<boolean> {
  const shorthand = captionFontShorthand(id, sizePx, cssVarValue);
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  // Sin FontFaceSet (jsdom, navegadores viejos) no hay nada que esperar ni nada
  // que prometer: el navegador va a usar lo que tenga.
  if (!fonts?.load) return true;
  try {
    await fonts.load(shorthand);
    return typeof fonts.check === "function" ? fonts.check(shorthand) : true;
  } catch (error) {
    console.error(
      "[bake-photo] no se pudo preparar la tipografía del texto, se usa la de respaldo:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * Valor de una variable CSS del `<html>`. `next/font` deja ahí la familia real
 * que generó (`--font-general-sans`, `--font-jakarta`), y `ctx.font` no resuelve
 * `var(--…)`: es una cadena suelta, sin cascada ni elemento del que heredar.
 */
function cssVarValue(name: string): string {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return "";
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name);
  } catch {
    return "";
  }
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  caption: PhotoCaption,
  fontSize: number,
) {
  const paddingX = Math.round(canvasWidth * 0.07);
  const maxTextWidth = canvasWidth - paddingX * 2;
  const lineHeight = Math.round(fontSize * 1.3);
  const color = resolveCaptionColor(caption.color ?? DEFAULT_CAPTION_COLOR);

  ctx.font = captionFontShorthand(caption.font ?? DEFAULT_CAPTION_FONT, fontSize, cssVarValue);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const lines = wrapText(ctx, caption.text, maxTextWidth, MAX_CAPTION_LINES);
  const blockHeight = lines.length * lineHeight;
  const paddingY = Math.round(fontSize * 0.55);

  let blockTop: number;
  if (caption.position === "top") {
    blockTop = paddingY * 2;
  } else if (caption.position === "center") {
    blockTop = Math.max(paddingY, (canvasHeight - blockHeight) / 2);
  } else {
    blockTop = canvasHeight - blockHeight - paddingY * 3;
  }

  if (caption.background === "solid") {
    // La barra es la CONTRARIA a la tinta (photo-overlay.ts): oscura bajo un
    // texto claro, clara bajo uno oscuro. Con la barra fija en oscuro, elegir
    // negro daba tinta casi negra sobre fondo casi negro. Los valores son
    // constantes y no tokens del tema a propósito: esto se quema en un JPEG y
    // no puede depender de si quien publica tenía el teléfono en modo oscuro.
    ctx.fillStyle = captionBarFill(color);
    ctx.fillRect(0, blockTop - paddingY, canvasWidth, blockHeight + paddingY * 2);
  } else {
    // Sin barra de fondo: la legibilidad la da un halo fuerte, nunca texto
    // flotando desnudo sobre una foto del mismo tono.
    ctx.shadowColor = captionHaloColor(color);
    ctx.shadowBlur = Math.round(fontSize * 0.4);
    ctx.shadowOffsetY = Math.round(fontSize * 0.05);
  }

  ctx.fillStyle = color.fill;
  const centerX = canvasWidth / 2;
  lines.forEach((line, index) => {
    const baseline = blockTop + lineHeight * (index + 1) - lineHeight * 0.3;
    ctx.fillText(line, centerX, baseline);
  });

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

// ---------------------------------------------------------------------------
// Emojis pegados sobre la foto
// ---------------------------------------------------------------------------

/**
 * Los emojis, con la MISMA cuenta que usó la vista previa (`stickerBox`, en
 * photo-overlay.ts): centro en fracciones del recuadro y tamaño contra el lado
 * corto. Que la cuenta viva en un módulo compartido y no acá es lo que hace que
 * el emoji caiga en el mismo lugar en la pantalla y en el archivo.
 *
 * `textBaseline = "middle"` y `textAlign = "center"` porque lo que se guardó es
 * el CENTRO del emoji: es la única referencia estable cuando además se puede
 * agrandar (un ancla en la esquina lo movería al escalar).
 *
 * El halo suave es funcional, no decorativo: un emoji oscuro sobre una foto
 * oscura desaparece, y a diferencia del texto no tiene barra donde apoyarse.
 */
function drawStickers(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  stickers: readonly PhotoSticker[],
) {
  if (stickers.length === 0) return;
  const box = { width: canvasWidth, height: canvasHeight };

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff"; // irrelevante en emoji de color; importa si el sistema sólo tiene la versión monocroma
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";

  for (const sticker of stickers) {
    const { centerX, centerY, fontSize } = stickerBox(sticker, box);
    ctx.font = `${fontSize}px ${STICKER_FONT_FAMILY}`;
    ctx.shadowBlur = Math.round(fontSize * 0.18);
    ctx.fillText(sticker.emoji, centerX, centerY);
  }

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.textBaseline = "alphabetic";
}

/** Ajuste de línea simple por palabra completa; corta en `maxLines`. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(attempt).width > maxWidth) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = attempt;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
