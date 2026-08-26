import "server-only";

import { resumenDeStats, supabaseSinTipar, type ResumenPuntaje } from "@/lib/resenas";

/**
 * Calificaciones (§ reseñas, 0093) de un lote de fichas, para la columna
 * "calificaciones" que pide la spec del cliente en cada card del directorio.
 *
 * UNA sola consulta batched contra `listing_review_stats` — la tabla agregada
 * que un trigger mantiene al día (mismo criterio documentado en
 * `components/resenas/queries.ts`: "el promedio NO se calcula acá"). Nada de
 * N+1: los ids de la página entran en un solo `.in(...)`.
 *
 * `listing_review_stats` todavía no está en `database.types.ts` (0093 es
 * posterior a la última regeneración) → cliente sin tipar, mismo patrón que
 * `fetchResenasDeAviso`. Al regenerar los tipos, se puede volver a tipar acá.
 */
export async function fetchListingRatings(
  supabase: unknown,
  listingIds: string[],
): Promise<Map<string, ResumenPuntaje>> {
  const byId = new Map<string, ResumenPuntaje>();
  const ids = [...new Set(listingIds.filter(Boolean))];
  if (ids.length === 0) return byId;

  const client = supabaseSinTipar(supabase);
  const { data, error } = await client
    .from("listing_review_stats")
    .select("listing_id, rating_avg, rating_count")
    .in("listing_id", ids);

  if (error) {
    console.warn("[profesionales] no se pudo leer el resumen de calificaciones", {
      code: error.code,
    });
    return byId;
  }

  const rows = (data ?? []) as Array<{
    listing_id: string;
    rating_avg: number | string | null;
    rating_count: number;
  }>;
  for (const row of rows) {
    byId.set(row.listing_id, resumenDeStats(row));
  }
  return byId;
}
