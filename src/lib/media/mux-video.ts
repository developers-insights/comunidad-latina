import { isMuxStatus, type MuxStatus } from "@/lib/mux/urls";

/**
 * MUX VISTO DESDE EL NAVEGADOR — el contrato, sin una línea de servidor.
 *
 * Mux transcodifica cualquier entrada (MKV, AVI, un .mov de 4K, lo que sea) y
 * entrega HLS adaptativo. Eso es lo que resuelve el pedido textual del cliente
 * —"que se pueda subir cualquier video de cualquier formato y de cualquier
 * tamaño"— y, de paso, lo que hace que el video se vea bien en 4G: el
 * reproductor baja la calidad que la red aguanta en vez de atragantarse con el
 * archivo original.
 *
 * ⚠️ DE DÓNDE SALE CADA COSA — Y POR QUÉ NO TODO DE `@/lib/mux`.
 *
 * `@/lib/mux` (el barril) es de SERVIDOR: re-exporta `isMuxConfigured`, que lee
 * `MUX_TOKEN_ID` y arrastra `server-only`. Traerlo a un archivo que termina en
 * un componente `"use client"` es el bug que ancla
 * `src/test/server-only-boundary.test.ts`.
 *
 * La mitad que SÍ puede ir al navegador vive en `@/lib/mux/urls`: el catálogo de
 * estados y los armadores de URL, sin credenciales. Este módulo importa DE AHÍ
 * —no redeclara nada— y le suma lo único que el navegador necesita además: cómo
 * PEDIR una subida, y cómo decidir qué se pinta.
 *
 * ── Y ENTONCES, ¿CÓMO SABE EL CLIENTE SI MUX ESTÁ PRENDIDO? ─────────────────
 * De dos maneras, y las dos hacen falta:
 *
 *  1. POR PROP, desde un Server Component (`muxEnabled={isMuxConfigured}` en
 *     `(app)/layout.tsx`). Se necesita ANTES de abrir el selector de archivos,
 *     porque el atributo `accept` del input se decide en ese instante — y ése es
 *     literalmente el bug que reportó el cliente (los .mov en gris).
 *  2. PREGUNTANDO. `POST /api/mux/subida` devuelve **503 cuando Mux no está
 *     configurado**, y ese 503 no es un error para la persona: es "andá por el
 *     camino de siempre". Es el patrón con el que ya degrada Stripe en este repo
 *     (`isStripeConfigured`): la feature se apaga sola y nadie ve nada roto.
 *
 * La prop sola no alcanzaría: puede quedar vieja respecto de un despliegue a
 * mitad de camino, o mentir si alguien la pasa mal. El 503 es la palabra final,
 * y por eso la subida SIEMPRE se decide con la respuesta del servidor.
 */

// ---------------------------------------------------------------------------
// El estado del video en Mux (posts.mux_status)
// ---------------------------------------------------------------------------

/**
 * Los cuatro estados por los que pasa un video, en orden real de vida:
 *
 *  · uploading  → el archivo está viajando del teléfono a Mux.
 *  · processing → Mux ya lo tiene y lo está transcodificando. TARDA: de unos
 *                 segundos a varios minutos, según duración y peso.
 *  · ready      → hay `mux_playback_id` y se puede reproducir.
 *  · errored    → Mux no pudo con el archivo. Es definitivo: no se reintenta solo.
 *
 * Se RE-EXPORTAN desde `@/lib/mux/urls` en vez de redeclararse: el catálogo es el
 * mismo que escribe el webhook en la base, y dos listas separadas se desalinean
 * en silencio (un estado que el servidor escribe y el cliente no reconoce cae a
 * "archivo", o sea que el video simplemente no aparece, sin ningún error).
 */
export { MUX_STATUSES, type MuxStatus } from "@/lib/mux/urls";

/**
 * La MINIATURA del video. También del módulo del backend: es la misma URL que
 * cualquier otra superficie puede querer, y armarla dos veces es cómo se llega a
 * que la tarjeta pida un JPG y otra pantalla un WebP del mismo fotograma.
 */
export { muxThumbnailUrl } from "@/lib/mux/urls";

/**
 * `posts.mux_status` es una columna de texto y lo que vuelve de la base es lo
 * que alguien escribió alguna vez. Mismo criterio (y misma forma) que
 * `parseVideoType`/`parseVideoCategory` en `video-policy.ts`: catálogo cerrado y
 * `null` para todo lo demás — incluido el `null` de la propia columna, que es el
 * caso de los 36 videos que ya estaban en el bucket antes de que Mux existiera.
 *
 * Quien decide qué es válido es `isMuxStatus`, del módulo del backend. Acá sólo
 * se cambia la forma de la respuesta: un `null` se compone mucho mejor que un
 * booleano cuando lo que sigue es elegir qué pintar.
 */
export function parseMuxStatus(raw: unknown): MuxStatus | null {
  return isMuxStatus(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// La ÚNICA decisión de reproducción
// ---------------------------------------------------------------------------

export interface MuxMediaState {
  /** posts.mux_playback_id. null/ausente = este video no pasó por Mux. */
  playbackId?: string | null;
  /** posts.mux_status crudo de la base: se normaliza acá adentro. */
  status?: unknown;
}

export type MuxPlaybackMode = "mux" | "processing" | "errored" | "archivo";

/**
 * QUÉ SE PINTA. Cuatro respuestas y UNA sola función — a propósito: la tarjeta
 * del feed, el reel y el visor a pantalla completa tienen que estar de acuerdo,
 * y la forma barata de que se desincronicen es que cada uno arme su propio `if`.
 *
 *  · "mux"        → hay playbackId y está listo: reproductor de Mux (HLS).
 *  · "processing" → Mux todavía está transcodificando. NUNCA un reproductor
 *                   vacío ni un cuadro negro: un estado honesto que dice que
 *                   falta un rato.
 *  · "errored"    → Mux no pudo. Se dice, no se esconde detrás de un player mudo.
 *  · "archivo"    → NO hay nada de Mux en esta fila. Es el camino de siempre:
 *                   `<video src>` contra el bucket de Supabase. Acá caen los 36
 *                   videos anteriores y todo lo que se suba con Mux apagado. Es
 *                   el default, y es el que no se toca.
 *
 * OJO CON EL ORDEN. `ready` SIN `playbackId` cae a "archivo", no a "mux": un
 * reproductor sin id de reproducción es un cuadro negro con controles, que es
 * justo lo que hay que evitar. Y un `playbackId` que ya está pero con estado
 * todavía `processing` tampoco reproduce: el id se escribe cuando Mux crea el
 * asset, que es ANTES de que exista el HLS.
 */
export function muxPlaybackMode(media: MuxMediaState | null | undefined): MuxPlaybackMode {
  const status = parseMuxStatus(media?.status);
  if (status === null) return "archivo";
  if (status === "errored") return "errored";
  if (status === "ready") {
    const playbackId = media?.playbackId?.trim();
    return playbackId ? "mux" : "archivo";
  }
  // uploading | processing: el archivo existe pero todavía no se puede ver.
  return "processing";
}

/** ¿Este estado todavía puede cambiar solo? Es lo que decide si vale sondear. */
export function muxStatusIsPending(status: MuxStatus | null): boolean {
  return status === "uploading" || status === "processing";
}

// ---------------------------------------------------------------------------
/**
 * La clave con la que un video de Mux guarda su filtro (0104) dentro de
 * `posts.media_filters`.
 *
 * El resto de ese objeto se indexa por la RUTA del archivo en el bucket, y un
 * video de Mux no tiene ninguna — `posts.media` viene sin él. Sin una clave
 * acordada entre quien escribe (`createPostAction`) y quien pinta (el player),
 * el filtro se guardaba y no había forma de encontrarlo.
 *
 * No puede chocar con una ruta real: las del bucket son `{tenant}/{user}/archivo`
 * y siempre llevan barras. Hay una sola por publicación porque Mux acepta un
 * video por borrador.
 */
export const MUX_FILTER_KEY = "mux";

// ---------------------------------------------------------------------------
// Pedir el permiso de subida (POST /api/mux/subida)
// ---------------------------------------------------------------------------

/** La ruta del backend. Una constante para que no se escriba a mano dos veces. */
export const MUX_UPLOAD_ENDPOINT = "/api/mux/subida";

/** Lo que devuelve el backend cuando Mux SÍ está configurado. */
export interface MuxUploadTicket {
  uploadId: string;
  /** URL firmada de Mux: la que come `UpChunk.createUpload({ endpoint })`. */
  uploadUrl: string;
  /** Fila de borrador que el backend ya creó para este video. */
  postDraftId: string;
}

export type MuxUploadRequest =
  | { ok: true; ticket: MuxUploadTicket }
  /**
   * `sin-mux` NO es un error: es el 503, o sea "no hay claves de Mux en este
   * entorno". Quien llama tiene que caer al bucket EN SILENCIO — sin toast, sin
   * disculpa, sin nada. La persona no tiene por qué enterarse nunca de que hay
   * un servicio de video de terceros detrás.
   */
  | { ok: false; reason: "sin-mux" }
  /** Cualquier otra cosa: red caída, 500, o una respuesta que no se entiende. */
  | { ok: false; reason: "falló" };

function esTicket(valor: unknown): valor is MuxUploadTicket {
  if (typeof valor !== "object" || valor === null) return false;
  const dato = valor as Record<string, unknown>;
  return (
    typeof dato.uploadId === "string" &&
    dato.uploadId.length > 0 &&
    typeof dato.uploadUrl === "string" &&
    dato.uploadUrl.length > 0 &&
    typeof dato.postDraftId === "string" &&
    dato.postDraftId.length > 0
  );
}

/**
 * Pide un permiso de subida directa. Es lo PRIMERO que pasa cuando alguien elige
 * un video, y su respuesta decide el camino entero:
 *
 *   ok            → UpChunk contra `uploadUrl`: resumible y sin nuestro tope de peso.
 *   sin-mux (503) → subida al bucket, como siempre, con su tope de 60 MB.
 *   falló         → también al bucket. Si el archivo entra por el tope viejo, la
 *                   persona publica igual y no se entera de nada; si no entra,
 *                   ahí sí se le avisa. Un problema nuestro no puede convertirse
 *                   en "no podés publicar".
 *
 * NO TIRA NUNCA. Un `throw` acá obligaría a cada llamador a envolver esto en un
 * try/catch, y el primero que se olvide deja el composer colgado con el botón
 * apagado — peor que subir por el camino lento.
 */
export async function requestMuxUpload(options?: {
  signal?: AbortSignal;
}): Promise<MuxUploadRequest> {
  let response: Response;
  try {
    response = await fetch(MUX_UPLOAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Body vacío pero presente: el backend puede crecer con campos (categoría,
      // tipo de video) sin que esta función tenga que cambiar de forma.
      body: JSON.stringify({}),
      cache: "no-store",
      signal: options?.signal,
    });
  } catch {
    // Red caída, CORS, el usuario canceló: todo cae al camino de siempre.
    return { ok: false, reason: "falló" };
  }

  // 503 es EL contrato: "Mux no está configurado". No se registra como error
  // porque no lo es — en desarrollo local es el estado normal.
  if (response.status === 503) return { ok: false, reason: "sin-mux" };
  if (!response.ok) return { ok: false, reason: "falló" };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "falló" };
  }
  if (!esTicket(payload)) return { ok: false, reason: "falló" };
  return { ok: true, ticket: payload };
}
