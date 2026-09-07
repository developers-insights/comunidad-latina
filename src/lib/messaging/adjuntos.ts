/**
 * =============================================================================
 * ADJUNTOS DEL CHAT — qué se puede mandar, cómo se llama y dónde vive
 * =============================================================================
 *
 * Fuente ÚNICA para el navegador y para la server action, igual que
 * `lib/media/post-media-limits.ts` lo es para el feed. Un límite escrito dos
 * veces no es un límite: es un picker que deja elegir algo que el servidor
 * después rechaza sin poder explicar por qué.
 *
 * Módulo sin `server-only` y sin DOM: lo importa un componente `"use client"` y
 * también un archivo `"use server"`.
 *
 * ─── LA CADENA DE PUERTAS, DE AFUERA HACIA ADENTRO ──────────────────────────
 *
 *   1. El `accept` del input        → cortesía, se saltea con un click
 *   2. `validarAdjunto` en el cliente → para que el aviso sea legible
 *   3. `validarAdjunto` en la action  → LA FRONTERA de la app
 *   4. `allowed_mime_types` + `file_size_limit` del bucket (0140) → la de Storage
 *   5. `chat_media_insert` (0140)     → el prefijo, contra el JWT
 *   6. `messages_adjunto_segun_kind` (0136) → que el tipo y el archivo no se
 *      contradigan
 *
 * Ninguna reemplaza a la siguiente. Las de acá existen para cortar antes de
 * gastar una subida y para devolver un error de producto en vez de un código
 * de PostgREST.
 */

/** El bucket privado de la 0140. Nada de chat vive en `post-media`. */
export const CHAT_MEDIA_BUCKET = "chat-media";

/**
 * Los tipos que acepta la app, indexados por su extensión.
 *
 * ⚠️ ESTA LISTA ES UN SUBCONJUNTO DE `allowed_mime_types` DEL BUCKET (0140).
 * Agregar acá algo que allá no esté es dejar elegir un archivo que Storage va a
 * rechazar con un 400 recién al subir — el modo de falla que la migración
 * describe como "el más confuso", porque del lado de quien prueba todo parece
 * andar hasta el último segundo. El test `adjuntos.test.ts` compara las dos
 * listas contra el SQL.
 *
 * Y lo que NO está tiene su motivo escrito en la 0140 §1: SVG (se abre como
 * documento y ejecuta scripts en el dominio del proyecto) y los comprimidos y
 * ejecutables (.zip, .exe, .apk — un chat privado es el mejor lugar del mundo
 * para pasar un archivo infectado y acá no hay nada que lo escanee).
 */
export const TIPOS_DE_ADJUNTO: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "application/pdf": "pdf",
};

/** Los `kind` de mensaje que llevan archivo (0136 §2.2). */
export const KINDS_CON_ADJUNTO = ["imagen", "video", "audio", "archivo"] as const;
export type KindConAdjunto = (typeof KINDS_CON_ADJUNTO)[number];

/** Todos los `kind` que el CHECK de la 0136 acepta. */
export const KINDS_DE_MENSAJE = [
  "texto",
  "imagen",
  "video",
  "audio",
  "archivo",
  "ubicacion",
  "perfil",
  "contenido",
] as const;
export type KindDeMensaje = (typeof KINDS_DE_MENSAJE)[number];

/**
 * Techo del bucket: `file_size_limit` de la 0140, exacto. No es "el límite que
 * elegimos", es el que ya está puesto en Storage — pasarse de acá es un 413 que
 * la app no puede explicar mejor.
 */
export const MAX_BYTES_DEL_BUCKET = 26_214_400; // 25 MiB

/**
 * Techo por tipo. Todos ≤ `MAX_BYTES_DEL_BUCKET` (lo verifica el test).
 *
 * La foto es la más chica y no por tacañería: viaja SIEMPRE horneada por
 * `bakePhoto` (1600 px de lado largo, JPEG ~0.85 → 250–800 KB), así que 8 MiB
 * ya son diez veces el peor caso realista. El margen existe para que un
 * horneado que falló y devolvió el original no rebote en silencio.
 */
export const MAX_BYTES_POR_KIND: Readonly<Record<KindConAdjunto, number>> = {
  imagen: 8 * 1024 * 1024,
  video: MAX_BYTES_DEL_BUCKET,
  audio: 16 * 1024 * 1024,
  archivo: MAX_BYTES_DEL_BUCKET,
};

/** Fotos y videos por envío. Diez tarjetas ya no entran en una pantalla. */
export const MAX_ADJUNTOS_POR_ENVIO = 10;

/** Pie de foto. El mismo techo que un mensaje de texto (0136 §2.1). */
export const MAX_PIE_DE_ADJUNTO = 2000;

/**
 * `"audio/webm;codecs=opus"` → `"audio/webm"`.
 *
 * MediaRecorder devuelve blobs con el codec pegado al tipo, y ese tipo no está
 * en `allowed_mime_types`. Ver el docblock de `CANDIDATOS_DE_GRABACION` en
 * `audio.ts`: es la misma trampa, y se paga en el Content-Type de la subida y
 * en `adjunto.mime`.
 */
export function mimeBase(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

/** Qué `kind` de mensaje le corresponde a este tipo, o `null` si no se acepta. */
export function clasificarMime(mime: string): KindConAdjunto | null {
  const base = mimeBase(mime);
  if (!(base in TIPOS_DE_ADJUNTO)) return null;
  if (base.startsWith("image/")) return "imagen";
  if (base.startsWith("video/")) return "video";
  if (base.startsWith("audio/")) return "audio";
  return "archivo";
}

export function extensionDeMime(mime: string): string | null {
  return TIPOS_DE_ADJUNTO[mimeBase(mime)] ?? null;
}

export type MotivoDeRechazo = "tipo" | "peso" | "vacio";

export type ValidacionDeAdjunto =
  | { ok: true; kind: KindConAdjunto; mime: string }
  | { ok: false; motivo: MotivoDeRechazo; kind: KindConAdjunto | null };

/**
 * LA misma pregunta que hace el navegador antes de subir y la action antes de
 * insertar. Allá es cortesía; acá —cuando la llama la action— es la frontera.
 */
export function validarAdjunto(entrada: {
  mime: string;
  bytes: number;
}): ValidacionDeAdjunto {
  const mime = mimeBase(entrada.mime);
  const kind = clasificarMime(mime);
  if (!kind) return { ok: false, motivo: "tipo", kind: null };
  if (!Number.isFinite(entrada.bytes) || entrada.bytes <= 0) {
    return { ok: false, motivo: "vacio", kind };
  }
  if (entrada.bytes > MAX_BYTES_POR_KIND[kind]) {
    return { ok: false, motivo: "peso", kind };
  }
  return { ok: true, kind, mime };
}

/**
 * La forma del nombre de archivo que el servidor acepta persistir.
 *
 * El UUID lo pone el navegador (`crypto.randomUUID`), así que no se confía en
 * él para autorizar nada — para eso están los dos primeros segmentos del path.
 * Lo que sí hace este patrón es cerrar la puerta a un nombre elegido a mano:
 * sin él, el cliente podría mandar un `path` con cualquier cosa adentro y el
 * `adjunto->>'path'` del mensaje quedaría apuntando a un objeto que él eligió.
 */
export const ADJUNTO_FILENAME_PATTERN =
  /^chat-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;

/**
 * `{tenant}/{user}/chat-{uuid}.{ext}` — el prefijo lo arma quien SABE el tenant
 * y el usuario (la server action, desde el guard y el JWT), nunca el cliente.
 *
 * ⚠️ CONTRATO CON LA POLICY DE LECTURA (0140 §3): esto es exactamente
 * `storage.objects.name` — sin el nombre del bucket adelante y sin barra
 * inicial— y es lo mismo que después se guarda en `adjunto->>'path'`. Si las
 * dos cadenas no coinciden carácter por carácter, quien mandó el archivo lo ve
 * (por la rama del prefijo propio) y quien lo recibe no.
 */
export function rutaDeAdjunto(
  tenantId: string,
  userId: string,
  mime: string,
  uuid: string,
): string | null {
  const extension = extensionDeMime(mime);
  if (!extension) return null;
  return `${tenantId}/${userId}/chat-${uuid}.${extension}`;
}

/**
 * "ESTA RUTA ES MÍA" — la revalidación del servidor, calcada de
 * `lib/media/own-media-path.ts`.
 *
 * El archivo se sube ANTES de que exista el mensaje, así que la action recibe
 * un `path` del cliente. Sin este chequeo, alguien con un token de la comunidad
 * apunta el adjunto de su mensaje al archivo de otra persona y se lo reenvía a
 * quien quiera: la policy de lectura del bucket habilita a ver cualquier objeto
 * referenciado por un mensaje VISIBLE, así que el mensaje falso sería la llave.
 *
 * El `..` se comprueba aparte porque la extensión necesita el punto, así que
 * prohibir el traversal no entra en la misma clase de caracteres.
 */
export function esRutaPropiaDeAdjunto(
  path: string,
  tenantId: string,
  userId: string,
): boolean {
  const segmentos = path.split("/");
  if (segmentos.length !== 3) return false;
  const [tenantSegmento, userSegmento, archivo] = segmentos;
  return (
    tenantSegmento === tenantId &&
    userSegmento === userId &&
    ADJUNTO_FILENAME_PATTERN.test(archivo) &&
    !archivo.includes("..")
  );
}

/**
 * El JSON que va a `messages.adjunto` / `chat_group_messages.adjunto` (0136).
 * `path` es lo único que el CHECK exige; el resto es lo que la burbuja necesita
 * para pintarse sin bajar el archivo.
 */
export interface Adjunto {
  path: string;
  mime: string;
  bytes: number;
  nombre?: string;
  ancho?: number;
  alto?: number;
  duracion_ms?: number;
  /** Picos 0–100 para dibujar la onda de un audio sin descargarlo (0140). */
  onda?: number[];
}

/**
 * Sube al bucket privado con progreso REAL.
 *
 * Gemelo de `lib/media/upload-video.ts`, que hace lo mismo contra `post-media`
 * y no se pudo reusar porque tiene el bucket escrito adentro. El porqué del XHR
 * está allá y vale igual acá: supabase-js sube con `fetch`, que no expone
 * `onprogress`, y sin barra de progreso subir un video en 4G es una pantalla
 * congelada.
 *
 * El cliente del navegador se importa DINÁMICAMENTE para que este módulo lo
 * pueda importar también la server action: `@/lib/supabase/client` arrastra
 * `createBrowserClient`, y un `"use server"` no tiene por qué cargarlo para
 * usar `validarAdjunto`.
 *
 * Nunca lanza: quien llama decide qué decirle a la persona.
 */
export async function subirAdjuntoConProgreso(
  archivo: Blob,
  path: string,
  contentType: string,
  onProgreso: (pct: number) => void,
  señal?: AbortSignal,
): Promise<boolean> {
  const { createClient } = await import("@/lib/supabase/client");
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
    xhr.open("POST", `${baseUrl}/storage/v1/object/${CHAT_MEDIA_BUCKET}/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    // Pelado a propósito: `allowed_mime_types` del bucket no conoce los
    // parámetros `;codecs=…` que trae un blob de MediaRecorder.
    xhr.setRequestHeader("Content-Type", mimeBase(contentType) || "application/octet-stream");
    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable && evento.total > 0) {
        onProgreso(Math.min(99, Math.round((evento.loaded / evento.total) * 100)));
      }
    };
    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (ok) onProgreso(100);
      resolve(ok);
    };
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    señal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(archivo);
  });
}

/**
 * Las columnas de la 0136 (`kind`, `adjunto`, `ubicacion`, `compartido_*`)
 * TODAVÍA NO ESTÁN en `database.types.ts`: los tipos se regeneran aparte y hoy
 * describen la tabla anterior a esa migración. Mismo escape que
 * `supabaseSinTiparGrupos` (0133) y con la misma condición: se pierde el tipado
 * del insert, así que la forma la sostienen los CHECK de la base y los tests de
 * esta action, no el compilador.
 *
 * Cuando se regeneren los tipos, esto se borra y el insert vuelve a tiparse.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function supabaseSinTiparMensajes(client: unknown): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any;
}
