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
 * Los ARCHIVOS de video no viajan por el body de la server action: suben
 * directo del navegador al bucket por XHR (`prepareMediaUploadAction` + policy
 * 0025). Lo único suyo que sí pasa por acá son las huellas que muestrea el
 * navegador (fotogramas y pista de audio), con su propio presupuesto abajo.
 *
 *  · Al ELEGIR del disco se acepta hasta `MAX_PICKED_PHOTO_BYTES`: es el
 *    archivo crudo de una cámara de teléfono y no tiene sentido rechazarlo,
 *    porque nunca se manda así. Este número NO cierra contra `bodySizeLimit`
 *    —el crudo no viaja— y por eso es el único de los cuatro que se puede mover
 *    solo. Ver su propio comentario.
 *  · Antes de publicar, `bakePhoto` recomprime SIEMPRE (1600 px de lado largo,
 *    JPEG ~0.85) → entre 250 y 800 KB por foto.
 *  · `MAX_PHOTO_BYTES` (2 MB) es el techo de lo que el servidor acepta RECIBIR
 *    por foto. Deja 2,5× de margen sobre el peor horneado realista y, al mismo
 *    tiempo, cierra la puerta a que se cuele un crudo — sea por un horneado
 *    fallido o por un cliente modificado.
 *  · `MAX_TOTAL_PHOTO_BYTES` (10 MB) es el techo del CONJUNTO. Sin él, 10 fotos
 *    de 2 MB serían 20 MB "válidos" que el propio `bodySizeLimit` corta antes
 *    de llegar: una validación que aprueba lo imposible no valida nada.
 *  · `next.config.ts` declara `serverActions.bodySizeLimit: "14mb"` — el total
 *    de fotos MÁS el presupuesto de huellas de video (`MAX_TOTAL_AUDIO_PCM_CHARS`
 *    y los fotogramas), más aire para el overhead de multipart y el texto.
 *    O sea: TODO payload que este módulo bendice puede llegar físicamente, y
 *    nada que llegue puede ser mucho más grande de lo que se bendice.
 *    `post-media-limits.test.ts` verifica esa relación contra el config real.
 */

/** Fotos por publicación. El composer y la action leen ESTE número. */
export const MAX_PHOTOS = 10;

/**
 * Videos por publicación por el camino del bucket. Mismo número que las fotos:
 * el carrusel ya los mezcla en cualquier orden.
 */
export const MAX_VIDEOS = 10;

/**
 * Con Mux configurado el tope vuelve a 1: `posts` guarda UN solo video de Mux en
 * columnas (`mux_upload_id`, `mux_playback_id`…) y su borrador es uno por post.
 */
export const MAX_VIDEOS_WITH_MUX = 1;

export function maxVideosPerPost(muxEnabled: boolean): number {
  return muxEnabled ? MAX_VIDEOS_WITH_MUX : MAX_VIDEOS;
}

/**
 * Peso máximo de una foto TAL COMO SE ELIGE del disco. SÓLO NAVEGADOR: el
 * servidor nunca ve este número, porque nunca ve este archivo.
 *
 * ─── POR QUÉ SUBIÓ DE 5 MB A 25 MB (2026-08-26) ────────────────────────────
 * El cliente reportó que las fotos rebotan por peso y por formato, igual que le
 * pasaba al video antes de Mux. Los 5 MB eran el número equivocado en el lugar
 * equivocado: una foto de un teléfono de 48 MP pesa 12-18 MB, y una HEIC de
 * iPhone en máxima calidad se va por arriba de 5 MB sin ningún esfuerzo. Se
 * rechazaban fotos absolutamente normales.
 *
 * Y se rechazaban por nada, porque el crudo NO VIAJA: `bakePhoto` recomprime
 * SIEMPRE a 1600 px de lado largo y JPEG ~0.85 —la haya editado alguien o no—
 * antes de armar el FormData. Lo que llega al servidor son 250-800 KB, mida lo
 * que mida el original. Los tres topes de abajo (`MAX_PHOTO_BYTES`,
 * `MAX_TOTAL_PHOTO_BYTES` y el `bodySizeLimit` de `next.config.ts`) miden ESO
 * y no se movieron ni un byte: la cadena que verifica `post-media-limits.test.ts`
 * quedó intacta.
 *
 * ENTONCES, POR QUÉ SIGUE HABIENDO UN TOPE ACÁ. Porque el límite real de esta
 * puerta no es la red: es la MEMORIA del teléfono. Hornear decodifica la foto
 * entera a un bitmap RGBA (4 bytes por píxel) antes de escalarla; una foto de
 * 100 MP son ~400 MB de RAM y Safari mata la pestaña sin decir nada. 25 MB
 * cubre con aire cualquier cámara de teléfono actual y deja afuera los TIFF y
 * los RAW de una réflex, que es justo donde empieza ese problema.
 *
 * La red del final sigue estando igual: si por lo que sea el horneado no puede
 * achicar el archivo, `checkPhotoPayload` lo frena antes de mandarlo y lo dice
 * con todas las letras.
 */
export const MAX_PICKED_PHOTO_BYTES = 25 * 1024 * 1024;

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

/**
 * HUELLAS DE LOS VIDEOS (Content Integrity) que sí viajan por el body.
 *
 * `MAX_AUDIO_PCM_CHARS` es lo máximo que produce `sampleAudioPcm` (120 s a
 * 8 kHz, Int16, en base64): algo más grande no salió de nuestro composer.
 * `MAX_TOTAL_AUDIO_PCM_CHARS` es el techo de TODAS las pistas juntas: alcanza
 * para un corto entero de 90 s (~1,9 M) y otro más; las pistas se mandan en
 * orden mientras entren y el resto viaja en null (ese video conserva la huella
 * de imagen, pierde sólo la de sonido).
 */
export const MAX_AUDIO_PCM_CHARS = 2_560_000;
export const MAX_TOTAL_AUDIO_PCM_CHARS = 3_000_000;

/** Cota de los fotogramas en JSON por video (4 matrices de 32×32, 0-255). */
export const MAX_VIDEO_FRAMES_JSON_CHARS = 20_000;

const AUDIO_SAMPLE_RATE = 8_000;
const AUDIO_MAX_SECONDS = 120;

/** Largo en base64 de la pista que va a producir un video de esta duración. */
export function predictedAudioPcmChars(durationSeconds: number): number {
  const seconds = Math.min(Math.max(durationSeconds, 0), AUDIO_MAX_SECONDS);
  const bytes = Math.ceil(seconds * AUDIO_SAMPLE_RATE) * 2;
  return Math.ceil(bytes / 3) * 4;
}

/**
 * Reparte el presupuesto de audio entre las pistas, en orden. Una pista que no
 * entra queda en null pero no corta a las siguientes: una más corta puede
 * entrar igual. La usan el composer (antes de mandar) y la action (al recibir).
 */
export function fitAudioTracks(tracks: readonly unknown[]): (string | null)[] {
  let budget = MAX_TOTAL_AUDIO_PCM_CHARS;
  return tracks.map((track) => {
    if (typeof track !== "string" || track.length === 0) return null;
    if (track.length > MAX_AUDIO_PCM_CHARS || track.length > budget) return null;
    budget -= track.length;
    return track;
  });
}

/**
 * Lee un arreglo JSON PARALELO a los videos (una entrada por video, en el mismo
 * orden). Un largo distinto se descarta entero: atribuir una huella al video
 * equivocado es peor que no tenerla. Ausente o ilegible = todos en null, que el
 * pipeline lee como "no se analizó".
 */
export function parseParallelVideoField(
  raw: FormDataEntryValue | null,
  count: number,
  maxChars: number,
): unknown[] {
  const empty = Array.from({ length: count }, () => null);
  if (typeof raw !== "string" || raw.length === 0 || raw.length > maxChars) return empty;
  try {
    const decoded: unknown = JSON.parse(raw);
    if (!Array.isArray(decoded) || decoded.length !== count) return empty;
    return decoded;
  } catch {
    return empty;
  }
}

/**
 * Fotogramas por video. Además del formato actual (`number[][][]`, uno por
 * video) acepta el del composer anterior —las matrices de UN video sueltas,
 * `number[][]`— cuando hay un solo video: una pestaña abierta antes del deploy
 * no tiene por qué perder la huella.
 */
export function parseVideoFramesField(
  raw: FormDataEntryValue | null,
  count: number,
  maxChars: number,
): unknown[] {
  if (count === 1 && typeof raw === "string" && raw.length > 0 && raw.length <= maxChars) {
    try {
      const decoded: unknown = JSON.parse(raw);
      if (
        Array.isArray(decoded) &&
        Array.isArray(decoded[0]) &&
        typeof (decoded[0] as unknown[])[0] === "number"
      ) {
        return [decoded];
      }
    } catch {
      return [null];
    }
  }
  return parseParallelVideoField(raw, count, maxChars);
}

/**
 * Pistas de audio por video. El composer anterior mandaba la pista de su único
 * video como base64 suelto, que nunca empieza con `[`: con un solo video se
 * acepta envuelta. El tope por pista lo aplica `fitAudioTracks` después.
 */
export function parseVideoAudioField(
  raw: FormDataEntryValue | null,
  count: number,
  maxChars: number,
): unknown[] {
  if (count === 1 && typeof raw === "string" && raw.length > 0 && !raw.startsWith("[")) {
    return [raw];
  }
  return parseParallelVideoField(raw, count, maxChars);
}
