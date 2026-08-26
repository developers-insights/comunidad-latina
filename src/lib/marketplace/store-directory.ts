import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseProductAttrs } from "@/components/marketplace/helpers";
import { resumenDeStats, supabaseSinTipar, type ResumenPuntaje } from "@/lib/resenas";
import type { Database } from "@/lib/types/database.types";

/**
 * =============================================================================
 * LECTURAS DE LA PESTAÑA "TIENDAS" — sin N+1
 * =============================================================================
 *
 * Las dos consultas de acá abajo existen por la misma razón: "cantidad de
 * artículos activos" y "calificaciones" (spec del cliente) NO se calculan
 * trayendo todo por tienda y contando en memoria — eso es un N+1 servido en
 * bandeja, uno por tarjeta del directorio. Cada función acá pide UNA vez, para
 * TODAS las tiendas de la página, y arma un Map en memoria: el costo crece con
 * la cantidad de FILAS que hay que leer, no con la cantidad de tiendas.
 */

type ServerClient = SupabaseClient<Database>;

/**
 * Resumen de calificaciones (listing_review_stats, migración 0093) de N
 * tiendas en una sola consulta. `listing_review_stats` todavía no está en
 * database.types.ts — mismo escape acotado que ya usa
 * src/components/resenas/queries.ts (`supabaseSinTipar`), con fecha de
 * vencimiento: cuando se regenere el archivo de tipos, esto se reemplaza por
 * `Tables<"listing_review_stats">`.
 */
export async function fetchStoreRatings(
  supabase: ServerClient,
  storeIds: string[],
): Promise<Map<string, ResumenPuntaje>> {
  const ratings = new Map<string, ResumenPuntaje>();
  if (storeIds.length === 0) return ratings;

  const { data, error } = await supabaseSinTipar(supabase)
    .from("listing_review_stats")
    .select("listing_id, rating_avg, rating_count")
    .in("listing_id", storeIds);

  if (error) {
    console.warn("[marketplace] no se pudo leer el resumen de calificaciones de tiendas", {
      code: (error as { code?: string }).code,
    });
    return ratings;
  }

  for (const row of (data ?? []) as {
    listing_id: string;
    rating_avg: number | string | null;
    rating_count: number;
  }[]) {
    ratings.set(row.listing_id, resumenDeStats(row));
  }
  return ratings;
}

/**
 * Cantidad de artículos ACTIVOS (kind='product', status='published') por
 * tienda, en una sola consulta.
 *
 * `attrs.store_listing_id` es jsonb SIN foreign key (mismo motivo que en
 * marketplace/(lista)/page.tsx y marketplace/tienda/[storeId]/page.tsx), así
 * que un `GROUP BY` real del lado de Postgres pediría una función nueva. En su
 * lugar:
 * se trae UNA vez el conjunto de productos activos que pertenecen a ALGUNA de
 * estas tiendas (sólo `id` + `attrs`, la misma columna que ya se lee en el
 * listado de Artículos) y se cuenta en JS. Sigue siendo UNA consulta total —
 * no una por tienda — así que no es el N+1 que se pidió evitar.
 *
 * Sí queda un límite real de escala: sin índice en `(attrs->>'store_listing_id')`
 * esta consulta escanea todos los productos publicados del tenant que caigan
 * en el filtro `in(...)`. Con pocos miles de productos por comunidad no pesa;
 * si el volumen crece, un índice de expresión (o una columna propia en vez de
 * jsonb) lo resuelve sin tocar esta función. El índice todavía NO existe: la
 * migración está pendiente, no aplicada.
 */
export async function fetchActiveListingCounts(
  supabase: ServerClient,
  params: { tenantId: string; storeIds: string[] },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (params.storeIds.length === 0) return counts;

  const { data, error } = await supabase
    .from("listings")
    .select("attrs")
    .eq("tenant_id", params.tenantId)
    .eq("kind", "product")
    .eq("status", "published")
    .in("attrs->>store_listing_id", params.storeIds);

  if (error) {
    console.warn("[marketplace] no se pudo contar artículos activos por tienda", {
      code: error.code,
    });
    return counts;
  }

  for (const row of data ?? []) {
    const storeId = parseProductAttrs(row.attrs).storeListingId;
    if (!storeId) continue;
    counts.set(storeId, (counts.get(storeId) ?? 0) + 1);
  }
  return counts;
}
