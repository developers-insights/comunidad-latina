/**
 * =============================================================================
 * HASTA DÓNDE LLEGA UNA CAMPAÑA — el `audience` que estaba guardado y dormido
 * =============================================================================
 *
 * `post_promotions.audience` (0023) guarda desde hace meses cuál es el alcance
 * comprado: `{"scope":"all"}` o `{"scope":"zones","zones":["Queens, NY", …]}`.
 * Nadie lo leía — `feed/queries.ts` lo dejó anotado con todas las letras: «se
 * guarda para segmentación geográfica futura». Prender "Tu zona" en el feed
 * obligó a mirarlo, porque sin esto las dos formas de romper el trato estaban
 * sobre la mesa a la vez:
 *
 *   · dejar todo como estaba ⇒ una campaña que eligió Queens se sigue viendo
 *     en el Bronx. Se cobró una zona y se entregó la comunidad entera.
 *   · filtrar el feed sin mirar `audience` ⇒ una campaña de alcance total
 *     desaparece para quien eligió mirar una zona. Se cobró todo y se entregó
 *     un barrio.
 *
 * MÓDULO PURO (sin Supabase, sin React): lo usan el camino con RPC y el camino
 * legado del feed, y los tests. El espejo en SQL vive en la rama ZONA de
 * `feed_posts_page` (0115) — los dos tienen que decidir lo mismo o el feed
 * cambia de contenido según qué entorno tenga la migración aplicada.
 */

/** Alcance comprado: `null` = toda la comunidad; lista = sólo esas zonas. */
export type ZonasDeCampana = string[] | null;

/**
 * El `audience` de una campaña → las zonas que compró, o `null` (= todas).
 *
 * Ante CUALQUIER duda devuelve `null`, y es deliberado: un jsonb con forma
 * inesperada (una campaña vieja, un dump a medio migrar) no puede achicar en
 * silencio un alcance que alguien pagó. Es la misma asimetría que
 * `boostReachesViewer` documenta en `@/lib/boosts/scope`: adentro de la
 * comunidad que cobró, ante la duda se entrega.
 */
export function zonasDeCampana(audience: unknown): ZonasDeCampana {
  if (!audience || typeof audience !== "object" || Array.isArray(audience)) return null;
  const registro = audience as Record<string, unknown>;
  if (registro.scope !== "zones") return null;
  if (!Array.isArray(registro.zones)) return null;
  const zonas = registro.zones
    .filter((zona): zona is string => typeof zona === "string")
    .map((zona) => zona.trim())
    .filter((zona) => zona.length > 0);
  // `{"scope":"zones","zones":[]}` no es "ninguna zona", es una campaña sin
  // segmentar bien guardada. Cobrada y sin entregar a nadie sería peor.
  return zonas.length > 0 ? zonas : null;
}

/**
 * ¿Esta campaña alcanza a quien está mirando esta zona?
 *
 * `areaLabels` son las etiquetas EXACTAS que `zonasCoincidentes` resolvió para
 * la zona activa (el match laxo ya se aplicó ahí). Vacío = quien mira no eligió
 * zona, o sea que está mirando toda la comunidad: le llega todo.
 */
export function campanaAlcanzaZona(
  zonas: ZonasDeCampana,
  areaLabels: readonly string[],
): boolean {
  if (zonas === null) return true;
  if (areaLabels.length === 0) return true;
  return zonas.some((zona) => areaLabels.includes(zona));
}
