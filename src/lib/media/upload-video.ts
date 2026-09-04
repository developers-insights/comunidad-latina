/**
 * =============================================================================
 * SUBIDA DIRECTA DE UN VIDEO AL BUCKET, CON PROGRESO
 * =============================================================================
 *
 * El video viaja del NAVEGADOR al bucket `post-media` sin pasar por el servidor:
 * una server action tiene techo de body y un archivo de 200 MB no entra. La
 * policy `post_media_insert` (0025) valida el prefijo {tenant}/{user} contra el
 * JWT, así que la subida es tan segura como cualquier otra escritura del usuario.
 *
 * POR QUÉ XHR Y NO supabase-js: el SDK usa `fetch`, que no expone `onprogress`.
 * Sin barra de progreso, subir cientos de megas en 4G es una pantalla congelada.
 * Se hace EXACTAMENTE el mismo request que haría el SDK.
 *
 * Vivía dentro de `post-composer.tsx`. Salió cuando apareció el segundo camino
 * que sube un video —el video publicitario de `/impulsar-post/[postId]`—, por lo
 * mismo que salió `own-media-path.ts`: dos copias de la misma subida son dos
 * lugares donde mañana hay que acordarse de arreglar el mismo bug.
 */

import { createClient } from "@/lib/supabase/client";

export const POST_MEDIA_BUCKET = "post-media";

/**
 * Sube `file` a `path` dentro de `post-media`. Devuelve `true` si el bucket lo
 * aceptó. NUNCA lanza: quien llama decide qué decirle a la persona.
 *
 * `contentType` es el CANÓNICO del contenedor (el que devuelve `checkVideoFile`
 * en `video-upload-limits.ts`), no `file.type` crudo: algunos navegadores
 * reportan vacío para formatos poco comunes (.3gp, .mkv en ciertos Android), y
 * mandar ese vacío mentiría sobre qué es el archivo en Storage.
 */
export async function uploadVideoWithProgress(
  file: File | Blob,
  path: string,
  onProgress: (pct: number) => void,
  contentType: string,
): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!accessToken || !baseUrl || !anonKey) return false;

  return new Promise<boolean>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${baseUrl}/storage/v1/object/${POST_MEDIA_BUCKET}/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      onProgress(100);
      resolve(xhr.status >= 200 && xhr.status < 300);
    };
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.send(file);
  });
}
