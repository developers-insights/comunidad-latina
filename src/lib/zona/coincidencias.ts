import { sameZoneLabel } from "@/lib/boosts/scope";

/**
 * =============================================================================
 * DE UNA ZONA ELEGIDA A UN FILTRO QUE SQL PUEDE RESPONDER
 * =============================================================================
 *
 * El match de zonas de esta app es LAXO por contención y sin acentos
 * (`sameZoneLabel`): "corona" ∈ "Corona, Queens" y al revés, "Bogotá" =
 * "Bogota". Eso no se puede expresar en un filtro de PostgREST sin reescribir
 * `normalizeGeoLabel` en SQL y mantener las dos versiones sincronizadas para
 * siempre — exactamente el trade-off que `@/lib/boosts/select` ya documentó y
 * resolvió con un colchón en memoria.
 *
 * Acá no sirve el colchón: estos listados PAGINAN por cursor, y filtrar después
 * del `limit` devolvería páginas de tamaño impredecible ("cargar más" trayendo
 * dos avisos). Así que se hace al revés: se resuelve el match ANTES, contra las
 * etiquetas que realmente existen en la comunidad, y a SQL le llega un `.in()`
 * de valores exactos. La paginación queda intacta y el criterio de comparación
 * sigue siendo UNO SOLO — `sameZoneLabel`, la misma función que decide si un
 * impulso local te alcanza.
 *
 * ── EL TECHO NO ES DECORATIVO ───────────────────────────────────────────────
 * Las lecturas de supabase-js son GET: el `.in(...)` viaja en el querystring, y
 * este repo tiene documentado el techo de 8 KB de URL. 25 etiquetas de 80
 * caracteres son ~2 KB en el peor caso, con lugar de sobra para el resto de la
 * query. Y una zona que empareja con más de 25 barrios distintos no está
 * filtrando nada útil de todos modos.
 */

export const ZONAS_MATCH_MAX = 25;

/**
 * Las etiquetas de `area_label` que cuentan como "esta zona".
 *
 * SIEMPRE arranca por la zona elegida tal cual se escribió, aunque no aparezca
 * en el catálogo: el catálogo se muestrea (`limit(200)`) y no puede ser la
 * única fuente de verdad — sin esta semilla, una etiqueta que existe pero no
 * cayó en la muestra devolvería un vacío falso. Con ella, el peor caso es
 * "filtró exacto" en vez de "filtró laxo".
 *
 * Devuelve `[]` SÓLO cuando no hay zona elegida, y eso significa "no filtres"
 * (nunca "no hay nada"): con zona elegida el resultado tiene al menos un
 * elemento, por la semilla.
 */
export function zonasCoincidentes(
  zona: string | null | undefined,
  zonasDelTenant: readonly string[],
): string[] {
  const elegida = typeof zona === "string" ? zona.trim() : "";
  if (!elegida) return [];

  const salida: string[] = [elegida];
  const vistas = new Set<string>([elegida]);

  for (const candidata of zonasDelTenant) {
    if (salida.length >= ZONAS_MATCH_MAX) break;
    const label = typeof candidata === "string" ? candidata.trim() : "";
    if (!label || vistas.has(label)) continue;
    if (!sameZoneLabel(elegida, label)) continue;
    vistas.add(label);
    salida.push(label);
  }

  return salida;
}
