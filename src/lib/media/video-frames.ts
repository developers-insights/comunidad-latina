"use client";

/**
 * MUESTREO DE FOTOGRAMAS EN EL NAVEGADOR — insumo de la huella de video.
 *
 * Hermano de `measure-video.ts` y por el mismo motivo: toca el DOM, así que
 * vive aparte y NO se re-exporta desde `./index` (un Server Component que
 * importe el barril no puede arrastrarse un módulo que crea elementos).
 *
 * QUÉ HACE: abre el archivo con un `<video>`, salta a cuatro instantes
 * repartidos, dibuja cada uno en un `<canvas>` de 32×32 en escala de grises y
 * devuelve las matrices de luminancia. Son ~4 KB en total: viajan en el
 * FormData de la publicación sin que nadie lo note.
 *
 * POR QUÉ ACÁ Y NO EN EL SERVIDOR: el video se sube DIRECTO al bucket porque no
 * entra en el body de una server action, así que el servidor nunca lo tiene
 * abierto. Sacar fotogramas allá pediría ffmpeg (~70 MB de binario nativo) en
 * una función serverless. Acá el decodificador ya existe y es gratis.
 * El límite de confianza de esta decisión está documentado en
 * `src/lib/integrity/video.ts` — y no afecta al SHA-256, que se calcula
 * siempre en el servidor sobre los bytes reales.
 *
 * NUNCA lanza: si el navegador no puede decodificar el video (códec raro,
 * archivo corrupto, permisos), devuelve un array vacío y el pipeline trata eso
 * como "no se pudo analizar" → revisión humana.
 */

import { LUMA_SIZE, VIDEO_FRAMES } from "@/lib/integrity/phash";

/** Coeficientes de luminancia Rec. 601 — los mismos que usa `sharp.greyscale()`. */
const R_WEIGHT = 0.299;
const G_WEIGHT = 0.587;
const B_WEIGHT = 0.114;

/** Techo de espera por fotograma. Un `seeked` que no llega no cuelga la subida. */
const SEEK_TIMEOUT_MS = 4_000;

function waitForEvent(element: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout esperando ${event}`));
    }, SEEK_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      element.removeEventListener(event, onDone);
      element.removeEventListener("error", onError);
    }
    function onDone() {
      cleanup();
      resolve();
    }
    function onError() {
      cleanup();
      reject(new Error(`error de video en ${event}`));
    }

    element.addEventListener(event, onDone, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

/**
 * Matrices de luminancia (32×32, valores 0-255) de VIDEO_FRAMES instantes del
 * video. Devuelve `[]` ante cualquier problema — nunca lanza.
 */
export async function sampleVideoLumaFrames(file: File): Promise<number[][]> {
  if (typeof document === "undefined") return [];

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    await waitForEvent(video, "loadeddata");

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (duration === 0) return [];

    const canvas = document.createElement("canvas");
    canvas.width = LUMA_SIZE;
    canvas.height = LUMA_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];

    const frames: number[][] = [];
    for (let index = 0; index < VIDEO_FRAMES; index += 1) {
      // Instantes repartidos evitando el primer y el último fragmento: los
      // arranques suelen ser negros y los finales, un fundido. Un fotograma
      // negro es idéntico en CUALQUIER video, o sea que sería ruido puro.
      const position = ((index + 0.5) / VIDEO_FRAMES) * duration;
      video.currentTime = Math.min(position, Math.max(0, duration - 0.05));
      await waitForEvent(video, "seeked");

      context.drawImage(video, 0, 0, LUMA_SIZE, LUMA_SIZE);
      const { data } = context.getImageData(0, 0, LUMA_SIZE, LUMA_SIZE);

      const luma: number[] = new Array(LUMA_SIZE * LUMA_SIZE);
      for (let pixel = 0; pixel < luma.length; pixel += 1) {
        const offset = pixel * 4;
        luma[pixel] = Math.round(
          data[offset] * R_WEIGHT + data[offset + 1] * G_WEIGHT + data[offset + 2] * B_WEIGHT,
        );
      }
      frames.push(luma);
    }

    return frames;
  } catch {
    // Códec no soportado, archivo corrupto, seek que nunca resolvió: sin
    // fotogramas. El servidor lo lee como "no se pudo analizar".
    return [];
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
