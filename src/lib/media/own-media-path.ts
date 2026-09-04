/**
 * =============================================================================
 * "ESTA RUTA DE post-media ES MÍA" — la comprobación, en un solo lugar
 * =============================================================================
 *
 * Toda ruta de `post-media` que un cliente MANDA (y no que el servidor arma)
 * tiene que comprobarse contra el tenant del guard y el usuario del JWT antes de
 * persistirse. El bucket es público de lectura: sin este chequeo, cualquiera con
 * un token de la comunidad puede apuntar el video —o el poster— de su
 * publicación a un archivo del prefijo de otra persona y quedarse con él.
 *
 * VIVÍA DENTRO DE `feed/actions.ts`, y ahí se quedó mientras hubo un solo camino
 * que persistía rutas de video. Desde que el video publicitario entra por
 * `/impulsar-post/[postId]` hay DOS, y dos copias de una regla de seguridad es
 * la forma más barata de que mañana una de las dos se quede vieja. Un archivo
 * ("use server" no puede exportar funciones sincrónicas, así que tampoco había
 * forma de importarla de la action).
 *
 * MÓDULO PURO a propósito: sin Supabase, sin DOM, sin React. Lo importan una
 * server action del feed y otra de impulsar, y las dos tienen que hacer la MISMA
 * pregunta.
 *
 * ESTO NO REEMPLAZA A LA POLICY. `post_media_insert` (0025) ya valida el prefijo
 * al SUBIR y el CHECK `posts_video_poster_path_shape` (0132) valida la forma al
 * GUARDAR. Esto corre en el medio, y su valor es doble: corta antes de gastar
 * una escritura, y devuelve un error de producto en vez de un código de
 * PostgREST.
 */

import {
  VIDEO_FILENAME_PATTERN,
  VIDEO_POSTER_FILENAME_PATTERN,
} from "./video-upload-limits";

/**
 * La forma común: exactamente {tenant}/{user}/{archivo}, tres segmentos y nada
 * más. El `..` se chequea aparte porque el charset del nombre de archivo tiene
 * que permitir el punto (lo necesita la extensión), así que prohibir el
 * traversal no entra en la misma clase de caracteres. Es el mismo par de
 * chequeos que corre el CHECK de la 0132 del lado de la base.
 */
function isOwnPath(
  path: string,
  tenantId: string,
  userId: string,
  filenamePattern: RegExp,
): boolean {
  const segments = path.split("/");
  if (segments.length !== 3) return false;
  const [tenantSegment, userSegment, filename] = segments;
  return (
    tenantSegment === tenantId &&
    userSegment === userId &&
    filenamePattern.test(filename) &&
    !filename.includes("..")
  );
}

/**
 * Path de VIDEO en post-media que el servidor acepta persistir en `posts.media`.
 *
 * Las extensiones válidas salen de `VIDEO_FILENAME_PATTERN` — el MISMO catálogo
 * que decide qué deja elegir el `accept` del composer. Estuvieron separados
 * (acá `(mp4|webm)` a mano, allá la lista completa) y el resultado era un picker
 * que dejaba elegir un `.mov` de iPhone y un servidor que lo rechazaba en
 * silencio recién al publicar.
 */
export function isOwnVideoPath(path: string, tenantId: string, userId: string): boolean {
  return isOwnPath(path, tenantId, userId, VIDEO_FILENAME_PATTERN);
}

/**
 * LA MISMA REGLA PARA EL POSTER (0132). Cambia una sola cosa: la extensión
 * válida es `.jpg` y no la lista de contenedores de video.
 */
export function isOwnPosterPath(path: string, tenantId: string, userId: string): boolean {
  return isOwnPath(path, tenantId, userId, VIDEO_POSTER_FILENAME_PATTERN);
}
