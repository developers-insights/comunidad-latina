/**
 * HORNEAR UNA FOTO — quemar el filtro y el texto en los píxeles, en el propio
 * navegador, ANTES de que el archivo viaje en el `FormData` de siempre.
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
 * SI ALGO FALLA (el navegador no soporta `ctx.filter`, `canvas.toBlob`
 * devuelve `null`, la imagen no se puede decodificar…) la función devuelve el
 * ARCHIVO ORIGINAL, tal cual se eligió, y el error queda logueado — nunca un
 * `catch {}` mudo. Quien llama decide cómo avisar (acá, un toast); lo que
 * nunca pasa es que un efecto decorativo le impida a alguien publicar.
 */

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
}

export interface BakePhotoOptions {
  /** Valor de `filter` (CSS/canvas). Vacío o `undefined` = sin filtro. */
  filterCss?: string;
  /** Texto sobre la foto. `undefined` o `text` vacío = no se dibuja nada. */
  caption?: PhotoCaption | null;
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
}

/** Quema filtro + texto en `file` y devuelve un JPEG liviano. Nunca lanza. */
export async function bakePhoto(file: File, options: BakePhotoOptions = {}): Promise<File> {
  const {
    filterCss = "",
    caption,
    maxLongSide = MAX_LONG_SIDE,
    quality = JPEG_QUALITY,
    onFallback,
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

    const scale = Math.min(1, maxLongSide / Math.max(source.width, source.height));
    const targetWidth = Math.max(1, Math.round(source.width * scale));
    const targetHeight = Math.max(1, Math.round(source.height * scale));
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.filter = filterCss && supportsFilter ? filterCss : "none";
    ctx.drawImage(source.draw, 0, 0, targetWidth, targetHeight);
    ctx.filter = "none"; // el texto de arriba nunca lleva el filtro de la foto

    const captionText = caption?.text.trim();
    if (caption && captionText) {
      drawCaption(ctx, targetWidth, targetHeight, { ...caption, text: captionText });
    }

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

function drawCaption(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  caption: PhotoCaption,
) {
  const paddingX = Math.round(canvasWidth * 0.07);
  const maxTextWidth = canvasWidth - paddingX * 2;
  const fontSize = clamp(Math.round(canvasWidth / 16), 22, 64);
  const lineHeight = Math.round(fontSize * 1.3);

  ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
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
    // Mismos valores que los tokens `media-shade`/`on-media` de globals.css
    // (#0d0c08 / #f7f6f3), que son CONSTANTES en light y dark. El texto acá
    // se quema en el JPEG: no puede depender del tema de quien publica, y
    // tiene que coincidir con la vista previa de photo-editor.tsx.
    ctx.fillStyle = "rgba(13, 12, 8, 0.55)";
    ctx.fillRect(0, blockTop - paddingY, canvasWidth, blockHeight + paddingY * 2);
  } else {
    // Sin barra de fondo: la legibilidad la da una sombra fuerte, nunca texto
    // blanco flotando desnudo sobre una foto clara.
    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = Math.round(fontSize * 0.4);
    ctx.shadowOffsetY = Math.round(fontSize * 0.05);
  }

  ctx.fillStyle = "#f7f6f3";
  const centerX = canvasWidth / 2;
  lines.forEach((line, index) => {
    const baseline = blockTop + lineHeight * (index + 1) - lineHeight * 0.3;
    ctx.fillText(line, centerX, baseline);
  });

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
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
