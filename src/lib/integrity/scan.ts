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
  maxDistance: number = DEFAULT_MAX_DISTANCE,
): Promise<ScanOutcome> {
  try {
    // `scan_content_asset` llegó con la 0070 y `database.types.ts` se regenera
    // aparte, así que todavía no figura en los tipos: el cast es por el TIPO
    // generado, no por el contrato — la función existe en la base y su EXECUTE
    // es de `service_role`, que es justo el cliente que llega acá. Mismo patrón
    // que `engagement-actions.ts` usa con las columnas recién migradas.
    const open = admin as unknown as SupabaseClient;
    const { error } = await open.rpc("scan_content_asset", {
      p_asset_id: assetId,
      p_max_distance: maxDistance,
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
