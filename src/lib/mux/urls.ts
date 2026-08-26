/**
 * =============================================================================
 * MUX — URLs de reproducción y estado. LA MITAD QUE SÍ PUEDE IR AL NAVEGADOR.
 * =============================================================================
 *
 * Este archivo NO importa `server-only` y no debe importarlo nunca. Es el único
 * módulo de `lib/mux` que un client component puede importar: son cuatro
 * funciones puras que arman strings, sin credenciales ni acceso a la base.
 *
 * ⚠️ El barril `@/lib/mux` sí es de servidor (re-exporta `isMuxConfigured`, que
 * lee env de servidor). Desde un client component se importa DE ACÁ:
 *
 *     import { muxStreamUrl, type MuxStatus } from "@/lib/mux/urls";
 *
 * ── POR QUÉ NO HAY QUE FIRMAR NADA ──────────────────────────────────────────
 * Los assets se crean con `playback_policies: ["public"]`. El contenido de la
 * comunidad es público —el mismo que ya se sirve desde el bucket `post-media`—
 * así que un playback firmado obligaría a emitir un JWT en cada reproducción
 * para proteger algo que no está protegido. Si algún día aparece video de pago,
 * ESA es la conversación: se cambia la política del asset y acá aparece un
 * módulo de firma. Hoy sería complejidad sin dueño.
 */

/**
 * Dónde está un video en el camino de Mux. Espeja el CHECK de
 * `posts.mux_status` (0116) — si esta unión y ese CHECK dejan de coincidir, la
 * app va a leer de la base un estado que no sabe nombrar.
 *
 *  · uploading  — la subida existe y el archivo está viajando desde el navegador.
 *  · processing — Mux ya tiene el archivo y lo está transcodificando.
 *  · ready      — hay playback id: se puede reproducir.
 *  · errored    — Mux no pudo con el archivo, o la subida se canceló/venció.
 */
export const MUX_STATUSES = ["uploading", "processing", "ready", "errored"] as const;

export type MuxStatus = (typeof MUX_STATUSES)[number];

/**
 * ¿Este texto —que puede venir de la base, de un payload o de un query param—
 * es un estado de Mux conocido?
 *
 * Existe para que nadie tenga que castear: `mux_status` en la base es `text`
 * nullable, y un `as MuxStatus` a ciegas es exactamente cómo un estado nuevo del
 * proveedor entra a la UI disfrazado de estado conocido.
 */
export function isMuxStatus(value: unknown): value is MuxStatus {
  return (
    typeof value === "string" && (MUX_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * URL del HLS adaptativo. Es lo que se le pasa al reproductor.
 *
 * HLS y no MP4 a propósito: es lo que hace que un video se vea en un celular con
 * señal mala sin cortarse — el reproductor baja de calidad en vez de frenar. Los
 * MP4 estáticos son otra rendición, se pagan aparte y para reproducir no hacen
 * falta (por eso el asset se crea SIN `mp4_support`).
 */
export function muxStreamUrl(playbackId: string): string {
  return `https://stream.mux.com/${encodeURIComponent(playbackId)}.m3u8`;
}

/**
 * Miniatura del video, como JPG.
 *
 * `time` en segundos, con default en 1: el primer fotograma de un video suele
 * ser negro o un fundido, y una grilla de miniaturas negras es peor que no tener
 * miniaturas. Un segundo adentro casi siempre ya hay imagen.
 *
 * `fit_mode=preserve` NO recorta: devuelve la imagen entera respetando su
 * proporción. Un recorte del lado de Mux le cortaría la cabeza a la mitad de los
 * videos verticales, que en este producto son casi todos.
 */
export function muxThumbnailUrl(
  playbackId: string,
  { timeSeconds = 1, width = 640 }: { timeSeconds?: number; width?: number } = {},
): string {
  const params = new URLSearchParams({
    time: String(timeSeconds),
    width: String(width),
    fit_mode: "preserve",
  });
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?${params.toString()}`;
}

/**
 * GIF animado de vista previa — para el hover de una tarjeta de video.
 * Opcional; ninguna superficie lo necesita para funcionar.
 */
export function muxAnimatedPreviewUrl(playbackId: string, width = 320): string {
  const params = new URLSearchParams({ width: String(width) });
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/animated.gif?${params.toString()}`;
}
