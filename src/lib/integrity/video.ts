import "server-only";

import { LUMA_SIZE, VIDEO_FRAMES, videoPhash256 } from "./phash";

/**
 * =============================================================================
 * HUELLA DE VIDEO — muestreo de fotogramas
 * =============================================================================
 *
 * DÓNDE SE MUESTREA Y POR QUÉ AHÍ.
 *
 * En este repo el video NUNCA pasa por el servidor: el navegador lo sube
 * DIRECTO al bucket `post-media` porque no entra en el body de una server
 * action, y la propia `feed/actions.ts` ya dice que medirlo del lado del
 * servidor "pediría ffprobe sobre el objeto ya subido, que es otro proyecto".
 * Sacar fotogramas server-side tiene el mismo problema, y peor: ffmpeg son ~70
 * MB de binario nativo, que es justo lo que no entra cómodo en una función de
 * Vercel.
 *
 * Así que el muestreo lo hace quien ya tiene el archivo abierto y un
 * decodificador de video gratis: el navegador, con `<video>` + `<canvas>`
 * (`src/lib/media/video-frames.ts`). Manda VIDEO_FRAMES matrices de
 * luminancia de 32×32 — un kilobyte cada una, nada al lado del video— y acá se
 * calculan las huellas.
 *
 * EL PRECIO, DICHO EN VOZ ALTA: los fotogramas los aporta el cliente, así que
 * un cliente modificado puede mandar fotogramas que no son los del video. Eso
 * NO abre un agujero de autoría, porque:
 *   · el SHA-256 —el camino que importa legalmente— se calcula SIEMPRE sobre
 *     los bytes reales, leídos del bucket por el servidor;
 *   · quien manda fotogramas falsos sólo consigue no aparecer en una alerta de
 *     "se parece", que es exactamente lo mismo que consigue quien re-edita el
 *     video, y contra eso ninguna huella perceptual puede nada.
 * Está documentado acá y en el reporte de entrega en vez de escondido.
 *
 * SI ALGÚN DÍA HAY UN WORKER CON FFMPEG: este archivo tenía preparado un
 * `videoPhashFromEncodedFrames(frames: Uint8Array[])` que entraba por imágenes
 * codificadas (PNG/JPEG), que es lo que escupiría ffmpeg. Se borró en la
 * auditoría 2026-08-13 por no tener consumidor. No se pierde nada de diseño:
 * lo que hacía era `imageLuma()` (./image) sobre cada fotograma y después el
 * mismo `videoPhash256`, o sea seis líneas. Lo que de verdad importaba —que la
 * huella sea comparable con las que ya están en la base— vive en
 * `videoPhash256`, no en el envoltorio.
 */

/** Cuántos fotogramas pide el pipeline. Re-export para el muestreador del navegador. */
export { VIDEO_FRAMES, LUMA_SIZE };

/** Un fotograma tal como lo manda el navegador: 32×32 valores de 0 a 255. */
export type LumaFrame = number[];

/**
 * ¿La matriz que llegó del cliente tiene la forma correcta?
 *
 * Se valida en el borde y no se confía: un array de largo equivocado haría
 * lanzar a `phash64` en medio de una publicación, y una publicación no se
 * puede caer porque un fotograma vino mal.
 */
export function isLumaFrame(value: unknown): value is LumaFrame {
  return (
    Array.isArray(value) &&
    value.length === LUMA_SIZE * LUMA_SIZE &&
    value.every((sample) => typeof sample === "number" && sample >= 0 && sample <= 255)
  );
}

/**
 * Huella de 256 bits a partir de las matrices de luminancia que muestreó el
 * navegador. Descarta las que no tienen la forma correcta; si no queda
 * ninguna, devuelve null ("no se pudo analizar", no "está limpio").
 */
export function videoPhashFromLumaFrames(frames: unknown): string | null {
  if (!Array.isArray(frames)) return null;
  const valid = frames.filter(isLumaFrame);
  if (valid.length === 0) return null;
  try {
    return videoPhash256(valid);
  } catch (error) {
    console.warn("[integrity] no se pudo armar la huella de video", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
    return null;
  }
}

