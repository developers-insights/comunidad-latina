import { normalizeDeclaredDuration } from "./video-policy";

/**
 * MEDIR EL VIDEO EN EL NAVEGADOR, ANTES DE SUBIR UN BYTE.
 *
 * El tope de 90 s tiene que rebotar ANTES de la subida: el archivo va directo
 * del navegador al bucket (60 MB de video contra una conexión de teléfono), así
 * que enterarse al publicar sería gastarle los datos a la persona para después
 * decirle que no. Y sin esta medición la publicación fallaría igual, pero
 * contra el CHECK `posts_video_declaration` de la base — un error de Postgres no
 * es un mensaje para nadie.
 *
 * Cómo se mide: un `<video preload="metadata">` fuera del documento apuntando a
 * un `blob:` del archivo. El navegador baja sólo la cabecera del contenedor, no
 * el archivo entero. Nunca lanza: si algo falla devuelve null y quien llama
 * decide (el composer rechaza — duración desconocida no se publica).
 */

/** Techo de espera. Un contenedor raro no puede dejar el botón colgado. */
const METADATA_TIMEOUT_MS = 15_000;

export async function readVideoDurationSeconds(file: File): Promise<number | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");

  try {
    return await new Promise<number | null>((resolve) => {
      let settled = false;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Soltar el archivo: sin esto el elemento sigue reteniendo el blob.
        video.removeAttribute("src");
        video.load();
        resolve(value);
      };

      const timer = setTimeout(() => finish(null), METADATA_TIMEOUT_MS);

      video.preload = "metadata";
      video.muted = true;
      // Algunos WebView de iOS no emiten loadedmetadata sin esto.
      video.playsInline = true;
      video.onloadedmetadata = () => finish(normalizeDeclaredDuration(video.duration));
      video.onerror = () => finish(null);
      video.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
