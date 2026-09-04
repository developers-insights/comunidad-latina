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

/**
 * Mismo origen que `BUCKET_ALLOWED_VIDEO_MIME_TYPES` para la lista de MIMEs,
 * pero el NÚMERO ya no depende del ⚠️ de arriba: desde la 0132 el
 * `file_size_limit` de `post-media` lo escribe una migración de este repo
 * (`update storage.buckets set file_size_limit = 250 * 1024 * 1024`), así que
 * esta constante y el bucket tienen por fin una sola fuente que se puede leer
 * en el árbol. 250 MB.
 */
export const BUCKET_FILE_SIZE_LIMIT_BYTES = 250 * 1024 * 1024;

/**
 * Peso máximo de un video tal como se elige del disco. 200 MB, con margen
 * debajo de `BUCKET_FILE_SIZE_LIMIT_BYTES` para que un archivo apenas pasado de
 * la raya lo rechace ESTE módulo con su mensaje, y no Storage con un error HTTP.
 *
 * ---- POR QUÉ SUBIÓ DE 60 A 200, Y POR QUÉ ES UN PARCHE -------------------
 *
 * El tope de 60 MB CONTRADECÍA en la práctica al de duración. `video-policy.ts`
 * permite 90 s en el feed, y 90 s de un iPhone en 1080p pesan 90–110 MB: el
 * cliente eligió un video de 1:29 —perfectamente legal por duración— y le
 * salió «Este video pesa 101 MB y el máximo son 60 MB» (2026-09-03, 21:20).
 * Dos reglas que se contradicen no son dos reglas: son un bug con dos números.
 *
 * ES UN PARCHE HASTA MUX, y hay que decirlo entero: el archivo se sirve CRUDO
 * desde el bucket, así que un video de 200 MB en el reel carga peor que uno de
 * 60. Subir el techo hace que el video del cliente ENTRE; no hace que se vea
 * rápido. Lo que arregla la carga es Mux (0116, `services.ts`), que
 * transcodifica a HLS adaptativo y ahí el tope real pasa a ser
 * `MAX_MUX_VIDEO_BYTES` (5 GB) — código listo, faltan las credenciales.
 * Mientras tanto el poster capturado al subir (0132) tapa la espera.
 */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

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

// ---------------------------------------------------------------------------
// EL POSTER DEL VIDEO (0132)
// ---------------------------------------------------------------------------

/**
 * El fotograma que el navegador captura al elegir el archivo viaja al MISMO
 * bucket, al MISMO prefijo `{tenant}/{user}/` y por la misma policy (0025, que
 * autoriza por prefijo y no por extensión). Lo único propio es el nombre.
 *
 * JPEG y no WebP aunque pese un poco más: el poster se pinta en el instante en
 * que el `<video>` todavía no tiene nada, o sea en el peor momento posible para
 * descubrir que un navegador viejo no decodifica el formato. JPEG lo abre todo.
 */
export const VIDEO_POSTER_EXTENSION = "jpg";
export const VIDEO_POSTER_CONTENT_TYPE = "image/jpeg";

/**
 * Nombre de archivo válido para un poster ya subido — lo usa la server action
 * antes de guardar la ruta en `posts.video_poster_path`.
 *
 * SIN la bandera `i`, a diferencia de `VIDEO_FILENAME_PATTERN`: el CHECK de la
 * 0132 es un `~` de Postgres (sensible a mayúsculas) sobre `\.jpg$`, y este
 * nombre nunca lo escribe una persona sino el composer, que siempre pone
 * minúsculas. Que las dos vallas acepten exactamente lo mismo es lo que evita
 * que la action deje pasar algo que la base después rechaza con un error crudo.
 */
export const VIDEO_POSTER_FILENAME_PATTERN = /^[A-Za-z0-9._-]+\.jpg$/;

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

// ---------------------------------------------------------------------------
// LAS DOS RUTAS DE SUBIDA
// ---------------------------------------------------------------------------

/**
 * POR DÓNDE VIAJA EL ARCHIVO — y, con eso, qué formatos y qué peso se aceptan.
 * Los dos techos de arriba (el bucket y el navegador) son reales, pero SÓLO
 * aplican a una de las dos rutas:
 *
 *  · "bucket" → navegador → Supabase Storage, como siempre. Los dos techos
 *    valen enteros: mp4/mov/webm y 60 MB. Es lo que corre cuando Mux no está
 *    configurado (503 de `/api/mux/subida`, ver `mux-video.ts`) y lo que va a
 *    seguir corriendo en desarrollo local para siempre.
 *
 *  · "mux" → navegador → Mux, por subida directa resumible (UpChunk). Los dos
 *    techos DESAPARECEN, y no por generosidad: dejan de ser ciertos.
 *      (1) El bucket ya no toca el archivo — no hay `allowed_mime_types` que
 *          pueda rechazarlo ya subido.
 *      (2) El navegador ya no tiene que reproducir el ORIGINAL: Mux
 *          transcodifica lo que sea y entrega HLS, así que un .mkv o un .avi
 *          —que ningún `<video>` abre— se ven perfecto igual. La razón nº2 del
 *          docblock de arriba deja de aplicar en esta ruta, que es exactamente
 *          lo que pedía el cliente.
 *
 * Es un parámetro y no una bandera global a propósito: el composer descubre la
 * ruta EN EL MOMENTO (preguntándole al backend), y las mismas funciones puras
 * tienen que poder contestar por las dos sin reiniciar nada.
 */
export type VideoUploadRoute = "bucket" | "mux";

/**
 * Extensiones de contenedor de video que se aceptan POR LA RUTA DE MUX. Esta
 * lista es larga a propósito y no tiene nada que ver con `VIDEO_FORMATS`: no
 * promete que el navegador los reproduzca (no los reproduce), promete que Mux
 * los sabe transcodificar. Existe para los casos en que el navegador NO reporta
 * un MIME útil — un .mkv suele llegar como `application/x-matroska` o vacío, y
 * mirar sólo el MIME lo dejaría afuera repitiendo el bug del .mov de iPhone.
 */
const MUX_VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  "mp4", "m4v", "mov", "qt", "webm", "mkv", "avi", "wmv", "asf", "flv", "f4v",
  "mpeg", "mpg", "mpv", "m2v", "vob", "3gp", "3g2", "ogv", "ogm", "mts", "m2ts",
  "ts", "mxf", "dv", "divx", "rm", "rmvb", "swf",
]);

/**
 * MIMEs que significan "el navegador no sabe qué es esto". No son un rechazo:
 * son la ausencia de información, y en la ruta de Mux la ausencia de información
 * no puede costarle la subida a nadie — quien sabe de verdad es Mux.
 */
const GENERIC_MIME_TYPES: ReadonlySet<string> = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/binary",
]);

/**
 * Techo de peso de la ruta de Mux: 5 GB. El pedido dice "de cualquier tamaño",
 * y en la práctica esto ES cualquier tamaño — el tope que realmente muerde es
 * el de DURACIÓN (90 s los cortos, 600 s la publicidad; `video-policy.ts`), y un
 * video de 10 minutos grabado en 4K no llega ni a 4 GB. El número existe igual
 * porque un formulario sin ningún techo es una forma de que alguien tire una
 * imagen de disco de 40 GB por accidente y se quede mirando una barra tres horas.
 */
export const MAX_MUX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * `accept` del input en la ruta de Mux: `video/*` a secas. Nada de listas.
 *
 * Es literalmente lo contrario de `VIDEO_ACCEPT_ATTR` y es correcto que lo sea:
 * ahí la lista existía para no dejar elegir lo que después iba a fallar; acá no
 * hay nada que vaya a fallar, así que cualquier lista sólo podría dejar afuera
 * algo válido. Con `video/*` el selector de macOS deja de pintar en gris los
 * .mov, que fue el reporte original del cliente.
 */
export const MUX_VIDEO_ACCEPT_ATTR = "video/*";

/** El `accept` que le corresponde al input según por dónde va a viajar el archivo. */
export function videoAcceptFor(route: VideoUploadRoute): string {
  return route === "mux" ? MUX_VIDEO_ACCEPT_ATTR : VIDEO_ACCEPT_ATTR;
}

/** El techo de peso de esa ruta. */
export function maxVideoBytesFor(route: VideoUploadRoute): number {
  return route === "mux" ? MAX_MUX_VIDEO_BYTES : MAX_VIDEO_BYTES;
}

/**
 * ¿Esto parece un video, para la ruta de Mux? La pregunta NO es "¿lo reproduce
 * el navegador?" sino "¿tiene sentido mandárselo a Mux?", y se contesta con la
 * regla más permisiva que sigue siendo honesta:
 *
 *  · MIME `video/…` → sí, sin más.
 *  · MIME vacío o genérico → sí. El navegador no supo; Mux sí va a saber.
 *  · Extensión de contenedor conocida → sí, aunque el MIME diga otra cosa
 *    (`application/x-matroska`, por ejemplo).
 *  · Todo lo demás → no. Un PDF, un .zip o una foto no son "un formato de video
 *    que todavía no soportamos": son otra cosa, y subir 2 GB para que Mux los
 *    rechace media hora después sería una crueldad.
 */
function looksLikeVideoForMux(mimeType: string, fileName: string): boolean {
  const normalizedMime = mimeType.trim().toLowerCase();
  if (normalizedMime.startsWith("video/")) return true;
  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex === -1 ? "" : fileName.slice(dotIndex + 1).toLowerCase();
  if (MUX_VIDEO_EXTENSIONS.has(extension)) return true;
  return GENERIC_MIME_TYPES.has(normalizedMime);
}

/**
 * ¿Se puede subir este archivo? Recibe `{ type, name, size }` —no un `File`—
 * para que sirva igual en el navegador y en cualquier test, sin DOM.
 *
 * El orden importa, igual que en `checkPhotoPayload`: primero el formato,
 * después el peso. Así el motivo que se devuelve es siempre el más
 * específico y accionable.
 *
 * `route` arranca en `"bucket"` a propósito: es el comportamiento de SIEMPRE, y
 * el default hace que todo llamador que no sepa de Mux —la server action, los
 * tests que ya existían— siga obteniendo exactamente la misma respuesta que
 * antes. Pedir la ruta de Mux es una decisión explícita de quien ya confirmó que
 * el backend la tiene prendida.
 */
export function checkVideoFile(
  file: {
    type: string;
    name: string;
    size: number;
  },
  route: VideoUploadRoute = "bucket",
): VideoFileCheck {
  if (route === "mux") {
    if (!looksLikeVideoForMux(file.type, file.name)) return { ok: false, reason: "type" };
    if (file.size > MAX_MUX_VIDEO_BYTES) return { ok: false, reason: "size" };
    // Extensión y MIME tal cual vinieron: en esta ruta no nombran ningún archivo
    // en ningún bucket (Mux se encarga), así que no hay nada que canonizar. Se
    // devuelven igual para que el tipo de retorno sea UNO solo y quien llama no
    // tenga que ramificar sobre la forma de la respuesta.
    const dotIndex = file.name.lastIndexOf(".");
    return {
      ok: true,
      extension: dotIndex === -1 ? "" : file.name.slice(dotIndex + 1).toLowerCase(),
      mimeType: file.type.trim().toLowerCase(),
    };
  }
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
export function formatVideoTooBigMessage(
  bytes: number,
  route: VideoUploadRoute = "bucket",
): string {
  // En la ruta de Mux el techo son 5 GB: decirlo en megabytes ("5120 MB") es un
  // número que nadie lee. Se cambia la UNIDAD, no la frase — el molde del
  // mensaje sigue siendo el mismo en las dos rutas.
  if (route === "mux") {
    const actualGb = Math.ceil((bytes / (1024 * 1024 * 1024)) * 10) / 10;
    const maxGb = Math.round(MAX_MUX_VIDEO_BYTES / (1024 * 1024 * 1024));
    return `Este video pesa ${actualGb} GB y el máximo son ${maxGb} GB. Probá con uno más corto.`;
  }
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

/**
 * El mismo rechazo, pero en la ruta de Mux — y dice algo COMPLETAMENTE distinto
 * porque el motivo es otro. Acá no hay ningún formato de video que sobre: si
 * este mensaje aparece es porque el archivo no es un video, punto. Nombrar MP4
 * como salida sería un consejo absurdo ("convertí tu PDF a MP4").
 */
export const MUX_WRONG_TYPE_MESSAGE =
  "Ese archivo no parece un video. Elegí el video que querés publicar.";

/** El rechazo por formato que corresponde a la ruta por la que se está subiendo. */
export function videoWrongTypeMessageFor(route: VideoUploadRoute): string {
  return route === "mux" ? MUX_WRONG_TYPE_MESSAGE : VIDEO_WRONG_TYPE_MESSAGE;
}
