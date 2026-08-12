/**
 * LÍMITES DE MEDIOS DE UNA PUBLICACIÓN — fuente ÚNICA para el navegador y para
 * la server action.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. El tope de fotos estuvo escrito dos veces: el
 * composer lo subió a 10 y `createPostAction` se quedó en 4. Publicar con más
 * de 4 fotos rebotaba con un `photo` genérico y ningún test se enteraba, porque
 * cada lado probaba su propio número. Un límite que vive en dos lugares no es
 * un límite, es una promesa que alguien va a romper. Acá vive el número Y la
 * regla: los dos lados llaman a `checkPhotoPayload` con los mismos bytes.
 *
 * Módulo PURO a propósito (sin DOM, sin `server-only`): lo importa un componente
 * `"use client"` y también un archivo `"use server"`.
 *
 * ─── CÓMO CIERRAN LOS NÚMEROS ──────────────────────────────────────────────
 *
 * Las fotos son lo ÚNICO que viaja por el body de la server action. El video no
 * pasa por acá: sube directo del navegador al bucket por XHR
 * (`prepareMediaUploadAction` + policy 0025), justamente para no chocar con
 * este límite. Por eso el presupuesto de abajo habla sólo de fotos.
 *
 *  · Al ELEGIR del disco se acepta hasta `MAX_PICKED_PHOTO_BYTES` (5 MB): es el
 *    archivo crudo de una cámara de teléfono y no tiene sentido rechazarlo,
 *    porque nunca se manda así.
 *  · Antes de publicar, `bakePhoto` recomprime SIEMPRE (1600 px de lado largo,
 *    JPEG ~0.85) → entre 250 y 800 KB por foto.
 *  · `MAX_PHOTO_BYTES` (2 MB) es el techo de lo que el servidor acepta RECIBIR
 *    por foto. Deja 2,5× de margen sobre el peor horneado realista y, al mismo
 *    tiempo, cierra la puerta a que se cuele un crudo de 5 MB — sea por un
 *    horneado fallido o por un cliente modificado.
 *  · `MAX_TOTAL_PHOTO_BYTES` (10 MB) es el techo del CONJUNTO. Sin él, 10 fotos
 *    de 2 MB serían 20 MB "válidos" que el propio `bodySizeLimit` corta antes
 *    de llegar: una validación que aprueba lo imposible no valida nada.
 *  · `next.config.ts` declara `serverActions.bodySizeLimit: "11mb"` — el total
 *    de arriba más 1 MB de aire para el overhead de multipart (bordes y headers
 *    de cada parte; los docs de Next hablan de 10-20 KB) y el cuerpo de texto.
 *    O sea: TODO payload que este módulo bendice puede llegar físicamente, y
 *    nada que llegue puede ser mucho más grande de lo que se bendice.
 *    `post-media-limits.test.ts` verifica esa relación contra el config real.
 */

/** Fotos por publicación. El composer y la action leen ESTE número. */
export const MAX_PHOTOS = 10;

/** Videos por publicación. No viaja por el body: sube directo al bucket. */
export const MAX_VIDEOS = 1;

/** Peso máximo de una foto TAL COMO SE ELIGE del disco (sólo navegador). */
export const MAX_PICKED_PHOTO_BYTES = 5 * 1024 * 1024;

/** Peso máximo de una foto TAL COMO LLEGA al servidor (ya horneada). */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Peso máximo de TODAS las fotos de una publicación, sumadas. */
export const MAX_TOTAL_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Por qué no se puede publicar este conjunto de fotos.
 *  · `count` — son más de las que entran en una publicación.
 *  · `photo` — hay una que pesa demasiado (típicamente: no se pudo recomprimir).
 *  · `total` — cada una entra, pero sumadas se van del presupuesto.
 */
export type PhotoPayloadRejection = "count" | "photo" | "total";

export type PhotoPayloadCheck =
  | { ok: true }
  | { ok: false; reason: PhotoPayloadRejection };

/**
 * ¿Se puede publicar este conjunto de fotos? Recibe los TAMAÑOS en bytes —no
 * los archivos— para que sirva igual en el navegador (después de hornear) y en
 * el servidor (sobre los `File` del FormData).
 *
 * El orden importa: primero el cupo, después el peso por archivo, último el
 * conjunto. Así el motivo que se devuelve es siempre el más específico, y el
 * mensaje que ve la persona le dice qué sacar.
 */
export function checkPhotoPayload(sizes: readonly number[]): PhotoPayloadCheck {
  if (sizes.length > MAX_PHOTOS) return { ok: false, reason: "count" };
  if (sizes.some((size) => size > MAX_PHOTO_BYTES)) {
    return { ok: false, reason: "photo" };
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total > MAX_TOTAL_PHOTO_BYTES) return { ok: false, reason: "total" };
  return { ok: true };
}
