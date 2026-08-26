"use client";

import * as UpChunk from "@mux/upchunk";

/**
 * =============================================================================
 * LA SUBIDA RESUMIBLE, ENVUELTA EN LO QUE EL COMPOSER NECESITA SABER
 * =============================================================================
 *
 * UpChunk parte el archivo en pedazos y los manda de a uno con `Content-Range`.
 * Eso es lo que hace que un video de 800 MB sea subible desde un teléfono en 4G:
 * si un pedazo falla se reintenta ESE pedazo, no el archivo; y si se cae la red,
 * la subida se pausa y retoma sola donde iba en vez de volver a cero.
 *
 * Esta capa existe para que el composer no tenga que conocer la forma de los
 * `CustomEvent` de la librería, y para que los números de sintonía —los que
 * deciden si esto anda bien o mal en 4G— vivan en un solo lugar, explicados.
 *
 * ── POR QUÉ NO SE COPIARON LOS NÚMEROS DE PONCHO ────────────────────────────
 * Poncho sube con `chunkSize: 30720` (30 MB) fijo. Para un panel de admin
 * cargando lecciones desde una computadora con fibra, está perfecto: menos
 * pedidos, menos ida y vuelta.
 *
 * Acá sería un error. En 4G, un pedazo de 30 MB tarda minutos, y si se corta a
 * mitad se reenvían los 30 MB enteros — la persona ve la barra retroceder y
 * repetir el mismo tramo una y otra vez. Por eso: pedazos chicos al arrancar
 * (5 MB) y `dynamicChunkSize`, que mide cuánto tardó cada pedazo y va agrandando
 * o achicando según lo que la red esté dando. En WiFi trepa solo hasta 30 MB y
 * queda tan rápido como Poncho; en una red mala baja a 1 MB y sigue avanzando en
 * vez de atascarse.
 */

/** Primer pedazo: 5 MB. Múltiplo de 256 KB, como exige UpChunk. */
const CHUNK_INICIAL_KB = 5 * 1024;
/** Piso: 1 MB. Por debajo de esto la sobrecarga por pedido se come la ganancia. */
const CHUNK_MINIMO_KB = 1 * 1024;
/** Techo: 30 MB. Es adonde llega solo cuando la red da (WiFi, 5G). */
const CHUNK_MAXIMO_KB = 30 * 1024;
/**
 * Reintentos por pedazo. Diez y no cinco a propósito: en un colectivo o en un
 * sótano la red va y viene varias veces en un mismo minuto, y cada uno de esos
 * baches se come un intento. Rendirse temprano es tirar una subida que iba bien.
 */
const INTENTOS_POR_PEDAZO = 10;
/** Segundos antes de reintentar. Dos: suficiente para que un bache pase. */
const ESPERA_ENTRE_INTENTOS_S = 2;

export interface MuxUploadCallbacks {
  /** Porcentaje 0–100 y bytes ya subidos, listos para pintar. */
  onProgress: (pct: number, uploadedBytes: number) => void;
  /** Se cayó la red. La subida NO murió: está esperando. */
  onOffline: () => void;
  /** Volvió la red y UpChunk retomó sola. */
  onOnline: () => void;
  /** El archivo entero llegó a Mux. Recién ahora empieza la transcodificación. */
  onSuccess: () => void;
  /**
   * Se acabaron los reintentos. No se pasa el mensaje de la librería a propósito
   * (ver `copy.ts`, regla 2): quien llama muestra copy de producto, nunca un
   * texto que diga "xhr status 502".
   */
  onError: () => void;
}

export interface MuxUploadHandle {
  /** Corta la subida. Idempotente: llamarlo dos veces no hace nada raro. */
  cancel: () => void;
}

export function startMuxUpload(
  input: { uploadUrl: string; file: File },
  callbacks: MuxUploadCallbacks,
): MuxUploadHandle {
  const { uploadUrl, file } = input;

  const upload = UpChunk.createUpload({
    endpoint: uploadUrl,
    file,
    chunkSize: CHUNK_INICIAL_KB,
    dynamicChunkSize: true,
    minChunkSize: CHUNK_MINIMO_KB,
    maxChunkSize: CHUNK_MAXIMO_KB,
    attempts: INTENTOS_POR_PEDAZO,
    delayBeforeAttempt: ESPERA_ENTRE_INTENTOS_S,
  });

  let cancelado = false;

  upload.on("progress", (event) => {
    if (cancelado) return;
    const pct = typeof event.detail === "number" ? event.detail : 0;
    // UpChunk informa porcentaje; los bytes se derivan del tamaño real del
    // archivo. Es una cuenta y no un dato del servidor, pero es exacta: el
    // porcentaje ya sale de bytes confirmados.
    callbacks.onProgress(pct, Math.round((file.size * pct) / 100));
  });

  upload.on("offline", () => {
    if (!cancelado) callbacks.onOffline();
  });

  upload.on("online", () => {
    if (!cancelado) callbacks.onOnline();
  });

  upload.on("success", () => {
    if (cancelado) return;
    callbacks.onProgress(100, file.size);
    callbacks.onSuccess();
  });

  upload.on("error", () => {
    // Un `abort()` propio también puede disparar `error` en algunos navegadores:
    // si ya cancelamos, esto no es una falla que haya que contarle a nadie.
    if (!cancelado) callbacks.onError();
  });

  return {
    cancel: () => {
      if (cancelado) return;
      cancelado = true;
      try {
        upload.abort();
      } catch {
        // Si ya había terminado, abortar tira: no hay nada que hacer.
      }
    },
  };
}
