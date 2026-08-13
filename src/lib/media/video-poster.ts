"use client";

/**
 * UN FOTOGRAMA DEL VIDEO, COMO IMAGEN — para el selector de filtros.
 *
 * El carrusel de filtros existe porque "Súper 8" no significa nada hasta que se
 * ve encima de TU material: cada chip es la propia imagen ya filtrada, así que
 * elegir es reconocer y no adivinar. Con un video no se puede pintar el video
 * 16 veces —serían 16 decodificadores corriendo a la vez para cuadritos de
 * 72 px—, así que se saca UN fotograma y esas 16 miniaturas lo comparten,
 * exactamente como `preview-thumb.ts` hace con una foto.
 *
 * Hermano de `video-frames.ts` (toca el DOM, vive aparte, no se re-exporta
 * desde ningún barril) y con la misma promesa: NUNCA LANZA. Si el navegador no
 * puede decodificar el archivo devuelve `null` y quien llama sigue con un
 * respaldo neutro — un códec raro puede costar miniaturas bonitas, nunca la
 * posibilidad de elegir un filtro.
 */

import { THUMB_SIZE } from "./preview-thumb";

/**
 * Segundo del que se saca el fotograma. No es 0 a propósito: muchísimos videos
 * arrancan con un cuadro negro o con el obturador todavía ajustando, y una tira
 * de 16 miniaturas negras no dice nada de ningún filtro. Un pelín adentro ya
 * hay imagen de verdad, y sigue estando dentro del primer segundo, así que el
 * salto es instantáneo incluso en un archivo largo.
 */
const POSTER_AT_SECONDS = 0.3;

/** Techo de espera. Un `seeked` que no llega no puede colgar el compositor. */
const SEEK_TIMEOUT_MS = 4_000;

function waitFor(video: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`El video no emitió "${event}" a tiempo`));
    }, SEEK_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener(event, onDone);
      video.removeEventListener("error", onError);
    }
    function onDone() {
      cleanup();
      resolve();
    }
    function onError() {
      cleanup();
      reject(new Error("El navegador no pudo decodificar el video"));
    }

    video.addEventListener(event, onDone, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

/**
 * Un cuadro del video como `data:` cuadrado de `size` px, o `null` si no se
 * pudo. El recorte es centrado porque el chip lo muestra con `object-cover`:
 * guardar los bordes que igual no se ven sería peso al pedo.
 */
export async function capturePosterFrame(
  src: string,
  size: number = THUMB_SIZE,
): Promise<string | null> {
  if (typeof document === "undefined" || !src) return null;

  const video = document.createElement("video");
  try {
    video.preload = "auto";
    // Silencioso y sin reproducir: esto es una captura, no una reproducción.
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = src;

    await waitFor(video, "loadeddata");

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;

    // Si el video dura menos que el offset, se saca el primer cuadro que haya.
    const target = Number.isFinite(video.duration)
      ? Math.min(POSTER_AT_SECONDS, Math.max(video.duration - 0.05, 0))
      : POSTER_AT_SECONDS;
    if (target > 0) {
      video.currentTime = target;
      await waitFor(video, "seeked");
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const side = Math.min(width, height);
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(
      video,
      (width - side) / 2,
      (height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch (error) {
    console.warn(
      "[video-poster] no se pudo sacar un fotograma para las miniaturas:",
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    // Soltar el decodificador: sin esto el elemento queda vivo con el archivo
    // entero enganchado hasta que pase el recolector.
    video.removeAttribute("src");
    video.load();
  }
}

/**
 * Respaldo cuando no hubo fotograma: un píxel gris neutro. Las 16 miniaturas
 * quedan planas, pero el filtro SIGUE viéndose sobre ellas —cálido, frío,
 * blanco y negro se distinguen igual— y cada chip conserva su nombre. Peor que
 * ver el propio video, muchísimo mejor que una tira de imágenes rotas.
 */
export const NEUTRAL_THUMB =
  "data:image/gif;base64,R0lGODlhAQABAIAAAJmZmQAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";
