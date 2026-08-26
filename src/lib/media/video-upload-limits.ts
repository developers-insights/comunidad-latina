/**
 * FORMATO Y PESO DE VIDEO AL SUBIR — el ÚNICO lugar donde viven ambos.
 *
 * Nace del feedback del cliente (video, textual): «en la parte de videos… si
 * es muy pesado no se puede subir, no sé qué onda. Y además antes nada más se
 * podían subir si no era de un tipo específico de formato… no te deja subir
 * cualquier tipo de video». En el video se veía el selector de macOS con los
 * .mov de la carpeta Descargas EN GRIS: `post-composer.tsx` declaraba
 * `accept="video/mp4,video/webm"` y un .mov de iPhone (`video/quicktime`) ni
 * aparecía seleccionable.
 *
 * Mismo patrón que `post-media-limits.ts` (fotos): una tabla de formatos +
 * funciones de chequeo PURAS, importables desde el composer (`"use client"`,
 * antes de subir un byte) y desde la server action que persiste el path ya
 * subido (`"use server"`, defensa en profundidad al guardar). Los dos lados
 * llaman a las MISMAS funciones — es lo que evita que el input acepte un
 * formato que el servidor después rechaza en silencio.
 *
 * EL CATÁLOGO ES SÓLO MP4, WEBM Y MOV (quicktime) — no todo lo que un
 * contenedor de video puede ser. Dos techos independientes lo definen así:
 *
 *  1. EL BUCKET. `post-media` en Supabase Storage tiene `allowed_mime_types`
 *     configurado (Dashboard, no en ninguna migración de este repo — 0025 crea
 *     el bucket sin fijarlo) y NO incluye MKV, AVI, MPEG ni 3GP/3G2. Subirlos
 *     directo desde el navegador (XHR a Storage, ver `uploadVideoWithProgress`
 *     en `post-composer.tsx`) los rechazaría YA SUBIDOS — el mismo bug que
 *     este módulo existe para cerrar, corrido un paso más adelante.
 *  2. EL NAVEGADOR. Aunque el bucket los aceptara, MKV/AVI/MPEG no reproducen
 *     nativamente en un `<video>` de HTML en ningún browser mayor sin códecs
 *     extra. Aceptarlos sería peor que rechazarlos en el selector: la persona
 *     gasta la subida entera y la publicación queda rota para todo el mundo.
 *
 * `BUCKET_ALLOWED_VIDEO_MIME_TYPES` y `BUCKET_FILE_SIZE_LIMIT_BYTES` (abajo)
 * son el primer techo, como dato explícito — `video-upload-limits.test.ts`
 * ancla que el catálogo de este módulo es SUBCONJUNTO de esa lista, para que
 * nunca se vuelvan a separar en silencio.
 *
 * ⚠️ PROVENANCIA DEL DATO DEL BUCKET — dejarlo escrito porque quedó una duda
 * real sin cerrar: el coordinador de esta tarea confirmó `file_size_limit` y
 * `allowed_mime_types` consultando el proyecto Supabase `ktmbtpuhqqofdkisqseq`
 * (2026-08-24). La memoria de ESTE repo (`proyectos-supabase-comunidad-latina`)
 * documenta ese mismo ref como un proyecto LEGACY compartido con otro cliente
 * ("caughtcode"), y al proyecto real de Comunidad Latina como
 * `vnfqzlcxpmofvsoxnptf`, visible sólo por el MCP `supabase-comunidad-latina`.
 * Intenté confirmar el dato contra ESE MCP cuatro veces (antes y después de
 * este mensaje) y las cuatro dio timeout de conexión, así que no pude
 * verificar cuál de los dos proyectos sirve producción de verdad. El recorte a
 * MP4/WebM/MOV es correcto de cualquier manera (razón 2 arriba, reproducción
 * en el navegador, no depende de qué proyecto sea el real); lo que SÍ podría
 * estar mal si el proyecto consultado no era el correcto es el número exacto
 * de `BUCKET_FILE_SIZE_LIMIT_BYTES`. Confirmar contra el Dashboard antes de
 * confiar ciegamente en el número si esto vuelve a discutirse.
 */

interface VideoFormatEntry {
  /** Alias MIME conocidos de este contenedor. `mimeTypes[0]` es el CANÓNICO. */
  mimeTypes: readonly string[];
  /** Extensiones aceptadas, sin el punto. `extensions[0]` es la CANÓNICA. */
  extensions: readonly string[];
}

/**
 * EL CATÁLOGO. Sólo los tres formatos que (a) el bucket `post-media` permite
 * subir y (b) el navegador reproduce nativamente en `<video>`. El .mov de
 * iPhone (`video/quicktime`) es el caso que reportó el cliente.
 */
const VIDEO_FORMATS: readonly VideoFormatEntry[] = [
  { mimeTypes: ["video/mp4"], extensions: ["mp4"] },
  // El caso reportado por el cliente: video de iPhone.
  { mimeTypes: ["video/quicktime"], extensions: ["mov"] },
  { mimeTypes: ["video/webm"], extensions: ["webm"] },
];

/**
 * LO QUE EL BUCKET `post-media` REALMENTE DEJA SUBIR — dato de
 * `storage.buckets.allowed_mime_types`, no de ninguna migración de este repo.
 * Ver el ⚠️ del docblock de arriba: la fuente es un proyecto cuya identidad no
 * pude verificar de forma independiente. `image/*` también está permitido en
 * el bucket (fotos) pero no aplica a este módulo, que sólo habla de video.
 *
 * SI ALGUIEN AMPLÍA ESTO EN EL DASHBOARD, HAY QUE AMPLIARLO ACÁ A MANO: no hay
 * ningún mecanismo que avise si se desalinean. Lo único que
 * `video-upload-limits.test.ts` puede anclar es que `VIDEO_FORMATS` (arriba)
 * sea SUBCONJUNTO de esta lista — no puede anclar que esta lista siga siendo
 * la verdad en Supabase.
 */
export const BUCKET_ALLOWED_VIDEO_MIME_TYPES: readonly string[] = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

/** Mismo origen y mismo ⚠️ que `BUCKET_ALLOWED_VIDEO_MIME_TYPES`. 80 MB. */
export const BUCKET_FILE_SIZE_LIMIT_BYTES = 80 * 1024 * 1024;

/**
 * Peso máximo de un video tal como se elige del disco. 60 MB — el mismo
 * número que ya promete `copy.ts` ("Subí un video corto, hasta 60 MB.") — con
 * margen cómodo debajo de `BUCKET_FILE_SIZE_LIMIT_BYTES`.
 */
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export const VIDEO_MIME_TYPES: readonly string[] = VIDEO_FORMATS.flatMap(
  (format) => format.mimeTypes,
);

export const VIDEO_FILE_EXTENSIONS: readonly string[] = VIDEO_FORMATS.flatMap(
  (format) => format.extensions,
);

/**
 * Valor del atributo `accept` del input de video. Lleva MIME types Y
 * extensiones: Safari/macOS puede ignorar un MIME poco común al decidir qué
 * dejar seleccionar en el picker, así que la extensión es la red de
 * seguridad. Generado desde `VIDEO_FORMATS` — nunca a mano, para que no se
 * vuelva a separar del resto de este módulo.
 */
export const VIDEO_ACCEPT_ATTR = [
  ...VIDEO_MIME_TYPES,
  ...VIDEO_FILE_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

/**
 * Regex que valida el NOMBRE de archivo de un path de video ya subido —
 * `isOwnVideoPath` en `feed/actions.ts` la importa DIRECTO de acá en vez de
 * mantener su propia lista. Generada desde `VIDEO_FILE_EXTENSIONS`, así que
 * nunca puede quedar más ancha que lo que el `accept` del composer ofrece.
 */
export const VIDEO_FILENAME_PATTERN = new RegExp(
  `^[A-Za-z0-9._-]+\\.(${VIDEO_FILE_EXTENSIONS.join("|")})$`,
  "i",
);

interface ResolvedVideoFormat {
  /** Extensión CANÓNICA (la que se usa para nombrar el archivo en el bucket). */
  extension: string;
  /** MIME CANÓNICO del contenedor — para el header `Content-Type` al subir. */
  mimeType: string;
}

const MIME_TO_FORMAT = new Map<string, ResolvedVideoFormat>();
const EXTENSION_TO_FORMAT = new Map<string, ResolvedVideoFormat>();
for (const format of VIDEO_FORMATS) {
  const canonical: ResolvedVideoFormat = {
    extension: format.extensions[0],
    mimeType: format.mimeTypes[0],
  };
  for (const mimeType of format.mimeTypes) MIME_TO_FORMAT.set(mimeType, canonical);
  for (const extension of format.extensions) EXTENSION_TO_FORMAT.set(extension, canonical);
}

/**
 * ¿Qué contenedor es este archivo? Primero confía en el MIME que reportó el
 * navegador (normalizado a minúsculas); si no lo reconoce —vacío, genérico
 * como "application/octet-stream", o simplemente ausente en algunos
 * navegadores— cae a la EXTENSIÓN del nombre de archivo. `null` = no es
 * ninguno de los tres formatos que se aceptan.
 *
 * Devuelve el par CANÓNICO (no el que reportó el navegador): es el mismo dato
 * que se usa para nombrar el archivo al subir y para el `Content-Type` real
 * del request — un solo lookup, un solo resultado, nada que pueda desalinearse.
 */
export function resolveVideoFormat(
  mimeType: string,
  fileName: string,
): ResolvedVideoFormat | null {
  const normalizedMime = mimeType.trim().toLowerCase();
  if (normalizedMime && MIME_TO_FORMAT.has(normalizedMime)) {
    return MIME_TO_FORMAT.get(normalizedMime)!;
  }
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const extension = fileName.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_TO_FORMAT.get(extension) ?? null;
}

export function isAcceptedVideoType(mimeType: string, fileName: string): boolean {
  return resolveVideoFormat(mimeType, fileName) !== null;
}

export type VideoFileRejection = "type" | "size";

export type VideoFileCheck =
  | { ok: true; extension: string; mimeType: string }
  | { ok: false; reason: VideoFileRejection };

/**
 * ¿Se puede subir este archivo? Recibe `{ type, name, size }` —no un `File`—
 * para que sirva igual en el navegador y en cualquier test, sin DOM.
 *
 * El orden importa, igual que en `checkPhotoPayload`: primero el formato,
 * después el peso. Así el motivo que se devuelve es siempre el más
 * específico y accionable.
 */
export function checkVideoFile(file: {
  type: string;
  name: string;
  size: number;
}): VideoFileCheck {
  const format = resolveVideoFormat(file.type, file.name);
  if (!format) return { ok: false, reason: "type" };
  if (file.size > MAX_VIDEO_BYTES) return { ok: false, reason: "size" };
  return { ok: true, extension: format.extension, mimeType: format.mimeType };
}

// ---------------------------------------------------------------------------
// Copy — mensajes de producto, no logs. Viven acá (y no en `feed/copy.ts`)
// para que el número/la lista salgan de la MISMA fuente que la validación.
// ---------------------------------------------------------------------------

/**
 * "Este video pesa 82 MB y el máximo son 60 MB. Probá con uno más corto."
 *
 * El peso REAL se redondea hacia ARRIBA (nunca declararlo más liviano de lo
 * que es — mismo criterio que `normalizeDeclaredDuration` en
 * `video-policy.ts`): un archivo de 60 MB + 1 byte tiene que leerse "61 MB",
 * nunca "60 MB" al lado de un máximo que también dice "60 MB".
 */
export function formatVideoTooBigMessage(bytes: number): string {
  const actualMb = Math.ceil(bytes / (1024 * 1024));
  const maxMb = Math.round(MAX_VIDEO_BYTES / (1024 * 1024));
  return `Este video pesa ${actualMb} MB y el máximo son ${maxMb} MB. Probá con uno más corto.`;
}

/**
 * Formato no soportado. Framea la razón en términos que la persona entiende
 * (no se REPRODUCE en la app) y no en la razón técnica real (el bucket lo
 * rechaza) — y da una salida concreta: convertir a MP4, el formato más
 * universal de los tres que se aceptan.
 */
export const VIDEO_WRONG_TYPE_MESSAGE =
  "Ese formato de video no se reproduce en la app — convertilo a MP4 y volvé a intentar.";
