import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * =============================================================================
 * ESCANEO DE INTEGRIDAD — duplicado exacto + coincidencia similar
 * =============================================================================
 *
 * LA REGLA VIVE EN SQL Y ACÁ NO SE REPITE.
 *
 * `public.scan_content_asset` (envoltorio de la 0070 sobre la función de la
 * 0061) es la ÚNICA definición de qué cuenta como duplicado: el match exacto por
 * sha256, la búsqueda perceptual por distancia de Hamming, el filtro por tenant,
 * la regla de "sólo contra assets anteriores" y las alertas que se levantan.
 * Este archivo la llama y cuenta el resultado. Nada más.
 *
 * (Hubo un momento en que no se podía llamar: el esquema `app` no está expuesto
 * por PostgREST y la app tuvo que mantener un espejo en TypeScript de toda esa
 * lógica. La 0070 agregó el envoltorio en `public` con EXECUTE sólo para
 * `service_role`, y el espejo se borró. Si algún día aparece la tentación de
 * reescribir el matching acá: no. Dos fuentes de verdad para "esto es un
 * duplicado" terminan en un bug silencioso que sólo se descubre cuando ya hubo
 * un reclamo.)
 */

/**
 * Umbral por defecto de la distancia de Hamming para "se parece".
 *
 * 10 sobre 64 bits ≈ 84% de bits iguales. Es el número que la 0061 pone como
 * default de `find_similar_content` y el que la práctica del pHash usa para
 * "misma imagen recomprimida o reescalada". Vive del lado de la app y no en la
 * base a propósito (comentario de `content_matches.distance`): depende del
 * medio, y quien llama es quien sabe qué medio está analizando.
 */
export const DEFAULT_MAX_DISTANCE = 10;

/**
 * Desde la 0088 el umbral ya no es uno solo: la huella de imagen son 64 bits y
 * las de video y audio son 256, así que un mismo número no puede servir para
 * las tres (10 sobre 256 apaga el detector de audio en silencio; 32 sobre 64 es
 * ruido puro). Los tres umbrales viven en `content_integrity_settings` por
 * comunidad y la función SQL los aplica sola.
 *
 * Por eso lo normal es NO pasar ninguno: `undefined` significa "usá los de esta
 * comunidad", que es la respuesta correcta salvo que quien llama tenga un
 * motivo explícito para pisarlos (un reproceso, un test).
 */
export interface ScanThresholds {
  /** Sólo la huella de IMAGEN (64 bits). Es lo que `DEFAULT_MAX_DISTANCE` fue siempre. */
  image?: number;
  /** Huella de video (256 bits). */
  video?: number;
  /** Huella de audio (256 bits). */
  audio?: number;
}

export type ScanOutcome =
  | {
      ok: true;
      /** Alertas ABIERTAS que tiene el asset después del escaneo. */
      openAlerts: number;
    }
  | { ok: false; error: string };

/**
 * Corre el análisis de integridad de un asset recién registrado.
 *
 * Nunca lanza: un escaneo caído devuelve `{ ok: false }` y quien llama manda el
 * contenido a revisión humana. Lo que jamás pasa es que una publicación se rompa
 * porque el análisis no pudo correr.
 */
export async function scanContentAsset(
  admin: SupabaseClient<Database>,
  assetId: string,
  thresholds: ScanThresholds = {},
): Promise<ScanOutcome> {
  try {
    // `null` en cada umbral = "usá el de la comunidad". No se manda un número
    // por las dudas: eso volvería a poner en la app una decisión que la 0088
    // puso, a propósito, en un solo lugar.
    //
    // Acá vivía un `admin as unknown as SupabaseClient`: `scan_content_asset`
    // llegó con la 0070 y los tipos generados estaban clavados en la 0076. Con
    // la regeneración del 2026-08-24 la función está tipada y la llamada es
    // directa — si algún día vuelve a hacer falta un cast así, lo que hay que
    // regenerar es `database.types.ts`, no agregar el cast.
    // `undefined` y no `null`, y significan lo mismo: los tres umbrales están
    // declarados `integer default null` en la 0088, así que OMITIR el argumento
    // le deja aplicar ese default. El generador de tipos de Supabase modela
    // "tiene default" como opcional y no modela que además acepte null, así que
    // pasarle `null` explícito no compila aunque la base lo aceptaría. Se
    // alinea el código con la firma generada en vez de castear.
    //
    // ⚠️ ESTO SERÍA UN BUG si `scan_content_asset` estuviera SOBRECARGADA.
    // supabase-js serializa con JSON.stringify, que **borra las claves
    // `undefined`**, y PostgREST elige la sobrecarga por el CONJUNTO DE NOMBRES
    // que recibe: con dos versiones vivas, omitir argumentos llamaría a la
    // equivocada en silencio. Acá no pasa —se verificó contra `pg_proc` el
    // 2026-08-24: existe una sola, la de cuatro parámetros; la de dos que creó
    // la 0070 ya no está—. Si alguna vez se agrega otra firma con este nombre,
    // hay que volver a mandar los tres explícitos y castear.
    const { error } = await admin.rpc("scan_content_asset", {
      p_asset_id: assetId,
      p_max_distance: thresholds.image ?? undefined,
      p_max_distance_video: thresholds.video ?? undefined,
      p_max_distance_audio: thresholds.audio ?? undefined,
    });

    if (error) {
      console.warn("[integrity] scan_content_asset falló", { code: error.code });
      return { ok: false, error: error.message };
    }

    // Cuántos ojos humanos hacen falta. Se cuenta DESPUÉS del escaneo y no se
    // deduce del valor que devolvió la función: `scan_content_asset` retorna los
    // matches exactos nuevos, que no es lo mismo que "alertas abiertas" — una
    // coincidencia similar o una licencia faltante también abren alerta y no
    // entran en ese número.
    const { count, error: countError } = await admin
      .from("content_integrity_alerts")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", assetId)
      .eq("status", "abierta");

    if (countError) return { ok: false, error: countError.message };
    return { ok: true, openAlerts: count ?? 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    console.warn("[integrity] escaneo de integridad falló", { message });
    return { ok: false, error: message };
  }
}
