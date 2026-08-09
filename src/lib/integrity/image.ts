import "server-only";

import { LUMA_SIZE, phash64 } from "./phash";

/**
 * =============================================================================
 * DECODIFICACIÓN DE IMAGEN — el único lugar del módulo que toca una librería
 * =============================================================================
 *
 * POR QUÉ `sharp` (y por qué no otra cosa):
 *
 *  · Ya está en el repo. Lo usan `scripts/generate-icons.mjs` y
 *    `scripts/cutout-icons.mjs`; agregar una segunda librería de imagen para
 *    hacer lo mismo sería sumar peso sin sumar capacidad.
 *  · Next.js ya lo trata como paquete externo del servidor por default, así que
 *    no hay que tocar `next.config.ts` ni pelearse con el bundler.
 *  · Las alternativas puras evaluadas no cierran: `jpeg-js` + `pngjs` NO
 *    decodifican WebP, y WebP es justamente el formato al que el composer
 *    convierte antes de subir — o sea que el formato más frecuente de la
 *    plataforma quedaría sin huella. Los decodificadores WASM (`@jsquash/*`)
 *    sí cubren los tres formatos, pero cambian un binario nativo probado por
 *    tres artefactos wasm que hay que servir y versionar a mano.
 *
 * EL PRECIO, DICHO EN VOZ ALTA: `sharp` es un binario nativo. Por eso NO se
 * importa arriba sino con `import()` adentro de un try: si el binario no está
 * (entorno raro, instalación a medias, plataforma sin build), este módulo
 * devuelve null y el pipeline degrada a "no se pudo analizar → que lo mire un
 * humano". Lo que jamás pasa es que una foto rompa una publicación porque una
 * librería de imágenes no cargó.
 */

/** La FUNCIÓN `sharp(...)`, no el namespace del módulo. */
type SharpFactory = (typeof import("sharp"))["default"];

/**
 * `undefined` = todavía no se intentó · `null` = se intentó y no está.
 * Se memoiza para no pagar el costo de un import fallido por cada foto.
 */
let cachedSharp: SharpFactory | null | undefined;

async function loadSharp(): Promise<SharpFactory | null> {
  if (cachedSharp !== undefined) return cachedSharp;
  try {
    const loaded = (await import("sharp")).default;
    cachedSharp = loaded;
    return loaded;
  } catch (error) {
    console.warn(
      "[integrity] sharp no disponible: las huellas perceptuales de imagen quedan sin calcular",
      { message: error instanceof Error ? error.message : "error desconocido" },
    );
    cachedSharp = null;
    return null;
  }
}

/** Solo para tests: olvida el resultado del import memoizado. */
export function resetSharpCache(): void {
  cachedSharp = undefined;
}

/**
 * Matriz de luminancia 32×32 (0-255) de una imagen codificada.
 *
 * `fit: "fill"` deforma la imagen a un cuadrado a propósito: el pHash tiene que
 * dar lo mismo para la misma foto reescalada, y recortar para mantener
 * proporción haría que dos versiones con distinto recorte de márgenes dieran
 * huellas distintas. `failOn: "none"` acepta archivos con warnings (un JPEG con
 * metadata rota sigue siendo una foto que la gente subió).
 *
 * Devuelve null si no se pudo decodificar. Nunca lanza.
 */
export async function imageLuma(bytes: Uint8Array): Promise<Uint8Array | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;

  try {
    const raw = await sharp(Buffer.from(bytes), { failOn: "none" })
      .greyscale()
      .resize(LUMA_SIZE, LUMA_SIZE, { fit: "fill" })
      .raw()
      .toBuffer();

    // `greyscale()` deja un canal, pero un archivo raro podría traer más
    // (CMYK mal etiquetado). Se toma el primer canal de cada píxel en vez de
    // asumir el largo: mejor una huella correcta que una excepción.
    if (raw.length === LUMA_SIZE * LUMA_SIZE) return new Uint8Array(raw);

    const channels = Math.max(1, Math.round(raw.length / (LUMA_SIZE * LUMA_SIZE)));
    if (raw.length < LUMA_SIZE * LUMA_SIZE * channels) return null;
    const luma = new Uint8Array(LUMA_SIZE * LUMA_SIZE);
    for (let i = 0; i < luma.length; i += 1) luma[i] = raw[i * channels];
    return luma;
  } catch (error) {
    console.warn("[integrity] no se pudo decodificar la imagen para su huella", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
    return null;
  }
}

/** Huella perceptual de 64 bits de una imagen codificada, o null si no se pudo. */
export async function imagePhash(bytes: Uint8Array): Promise<string | null> {
  const luma = await imageLuma(bytes);
  return luma ? phash64(luma) : null;
}
