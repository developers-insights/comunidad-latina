import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * Lectura de un objeto del bucket para calcular su huella.
 *
 * POR QUÉ NO SE USA `storage.download()`: ese helper hace `res.blob()`, o sea
 * que se trae el archivo ENTERO a memoria antes de que podamos mirarle el
 * tamaño. Para una foto da igual; para un video de 40 MB dentro de una función
 * serverless, no. Acá se pide una URL firmada y se lee el `content-length`
 * ANTES de leer un solo byte del cuerpo: si el archivo pasa el tope, se corta
 * el stream y listo.
 *
 * El SHA-256 se calcula INCREMENTALMENTE sobre el stream. Los bytes completos
 * sólo se acumulan cuando el que llama los necesita (la huella perceptual de
 * una imagen los necesita; la de un video no, porque los fotogramas ya vienen
 * muestreados del navegador).
 *
 * ⚠️ Esto es `service_role`: uso permitido (ARQUITECTURA §6, "moderación
 * server-side"), jamás para servirle bytes a nadie — sólo para hashearlos.
 */

export type StorageReadResult =
  | { ok: true; sha256: string; byteSize: number; bytes: Uint8Array | null }
  | { ok: false; reason: "demasiado-grande" | "no-encontrado" | "error"; detail?: string };

/**
 * Tope de tiempo de la descarga completa, cuerpo incluido.
 *
 * `AbortSignal.timeout` corta el stream, no sólo el handshake: si Storage se
 * degrada a mitad de un archivo, la lectura no queda colgada esperando bytes que
 * no llegan. Sin esto, el `fetch` no tenía NINGÚN límite y esta función corre
 * dentro del request de publicación — o sea, el tope real era el de la
 * plataforma, con la persona mirando el spinner hasta el final.
 *
 * 20 s es holgado para los 24 MB del tope (`MAX_INLINE_BYTES`) en un enlace
 * servidor-a-servidor y sigue siendo mucho menos que el límite de la función. El
 * riesgo de acortarlo es real y va en la dirección contraria: un timeout corto
 * manda a revisión humana archivos perfectamente sanos. Por eso el corte se
 * loguea distinto de un error cualquiera — si empieza a aparecer seguido, el
 * número está mal o Storage está en problemas, y en los dos casos se ve.
 */
const DOWNLOAD_TIMEOUT_MS = 20_000;

export async function hashStorageObject(
  admin: SupabaseClient<Database>,
  bucket: string,
  path: string,
  options: { maxBytes: number; keepBytes: boolean },
): Promise<StorageReadResult> {
  try {
    const { data: signed, error: signError } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, 60);

    if (signError || !signed?.signedUrl) {
      return { ok: false, reason: "no-encontrado", detail: signError?.message };
    }

    // Mismo patrón que `lib/tenant/domain-lookup.ts`: todo fetch que sale de
    // nuestro proceso lleva su propio tope de tiempo.
    const response = await fetch(signed.signedUrl, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return { ok: false, reason: "no-encontrado", detail: `HTTP ${response.status}` };
    }

    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > options.maxBytes) {
      await response.body.cancel();
      return { ok: false, reason: "demasiado-grande" };
    }

    const hash = createHash("sha256");
    const chunks: Uint8Array[] = [];
    let byteSize = 0;

    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byteSize += value.byteLength;
      // Segunda línea del tope: un `content-length` ausente o mentiroso no
      // puede convertirse en un archivo sin límite dentro de la función.
      if (byteSize > options.maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "demasiado-grande" };
      }
      hash.update(value);
      if (options.keepBytes) chunks.push(value);
    }

    let bytes: Uint8Array | null = null;
    if (options.keepBytes) {
      bytes = new Uint8Array(byteSize);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }

    return { ok: true, sha256: hash.digest("hex"), byteSize, bytes };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error desconocido";
    // NO ES UN CATCH MUDO, y el motivo es operativo: este return manda el
    // archivo a revisión humana. Si Storage se degrada, TODO cae a la cola y el
    // equipo ve la fila inundada sin ninguna pista de que la causa es la
    // descarga y no el contenido. Con esta línea, la causa está a un grep.
    // El `signedUrl` NO se loguea: es una credencial de lectura.
    const porTiempo = error instanceof Error && error.name === "TimeoutError";
    console.error(
      porTiempo
        ? `[integrity] la descarga de ${bucket}/${path} pasó los ${DOWNLOAD_TIMEOUT_MS} ms y se cortó — el archivo va a revisión humana. Si se repite, es Storage, no el contenido.`
        : `[integrity] no se pudo leer ${bucket}/${path} para la huella: ${detail} — el archivo va a revisión humana.`,
    );
    return { ok: false, reason: "error", detail };
  }
}
