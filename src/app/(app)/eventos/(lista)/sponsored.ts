import type { EventCardModel } from "@/components/directory";

/**
 * DECISIÓN DE ORDEN — patrocinados en Eventos (tarea 2026-08-05, ver
 * `boostedIds` y el bloque `sponsored`/`upcomingRest`/`pastRest` en page.tsx).
 *
 * Eventos NO es /propiedades: acá el orden cronológico (próximos primero) ES
 * la utilidad del listado, no un detalle de implementación. "Boosted-first"
 * absoluto pondría un evento pago de dentro de 3 meses arriba de los de esta
 * semana — vende visibilidad a costa de romper la razón de ser de la
 * pantalla.
 *
 * Elegida: (b) los patrocinados se separan en su PROPIA franja "Patrocinados"
 * arriba de todo (mismo anillo dorado + chip que /propiedades), y el resto
 * del listado (`upcoming`/`past`) queda 100% cronológico e intacto — como si
 * el patrocinado no existiera para el orden de los demás.
 *
 * Descartadas:
 *   (a) boosted-first DENTRO de cada grupo temporal — mismo problema acotado
 *       al grupo: un evento pago de fin de mes seguiría saltando arriba de
 *       uno de mañana dentro de "upcoming" (que no tiene límite de fecha).
 *   (c) boosted-first solo en los próximos 30 días — reduce el salto pero no
 *       lo elimina (un pago a 25 días seguiría por delante de uno de
 *       mañana), y suma una ventana arbitraria que nadie pidió.
 *
 * (b) es la única que preserva el 100% de la utilidad cronológica para lo NO
 * pagado, que es la mayoría del listado — y es honesta (FTC): lo pago vive en
 * su propio espacio marcado, no se disfraza de "el próximo evento".
 *
 * Los patrocinados salen de `groups` (ya filtrados por q/entrada/ciudad/cuando
 * en page.tsx) — por eso respetan los filtros activos: uno que no matchea
 * simplemente no está en ningún grupo y nunca llega acá. `max` topea el
 * tamaño de la franja para que no compita en volumen con el resto (mismo
 * límite que la query de boosts, `SPONSORED_LIMIT`).
 *
 * Vive acá y no en page.tsx porque Next sólo admite un juego cerrado de
 * exports en un archivo `page` (default, metadata, revalidate…): exportar un
 * helper desde ahí rompe el build aunque `tsc --noEmit` lo dé por bueno.
 * Mismo criterio que impulsar/impulsar-items.ts — la RSC hace las queries, el
 * módulo puro tiene la decisión y es el que se testea (entorno node, sin
 * jsdom ni mock de Supabase).
 */
export function extractSponsored(
  groups: readonly EventCardModel[][],
  boostedIds: ReadonlySet<string>,
  max: number,
): { sponsored: EventCardModel[]; rest: EventCardModel[][] } {
  const seen = new Set<string>();
  const sponsored: EventCardModel[] = [];
  for (const group of groups) {
    for (const card of group) {
      if (sponsored.length < max && boostedIds.has(card.id) && !seen.has(card.id)) {
        seen.add(card.id);
        sponsored.push(card);
      }
    }
  }
  const rest = groups.map((group) => group.filter((card) => !seen.has(card.id)));
  return { sponsored, rest };
}
