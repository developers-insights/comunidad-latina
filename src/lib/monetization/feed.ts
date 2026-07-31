import { isRecommendedFeedEligible } from "./tier";

/**
 * DISTRIBUCIÓN: qué avisos entra al News Feed principal RECOMENDADO.
 *
 * La regla del contrato, entera: la publicación gratuita aparece **en el perfil
 * de quien la publicó, en el feed de sus seguidores, en las búsquedas y en el
 * feed de su módulo**. Lo único que NO recibe es el empujón que la app da sin
 * que nadie lo pida — el "Para ti". La premium sí.
 *
 * ESTO ES ALCANCE, NO PERMISOS. Misma doctrina que ya usa el feed para "solo
 * seguidores": un aviso `published` sigue siendo público en su detalle, en su
 * módulo y por link. Lo que esta función decide es a quién se lo MOSTRAMOS
 * proactivamente. El aislamiento real lo dan las policies, no este string.
 *
 * Las TRES excepciones que el filtro deja pasar aunque el aviso sea gratuito, y
 * por qué cada una:
 *
 *   · `tier = premium` — es lo que se pagó.
 *   · el aviso es de una entidad que el viewer SIGUE — seguir es pedirlo
 *     explícitamente; cobrarle a alguien por llegar a quien ya lo eligió sería
 *     cobrar dos veces.
 *   · el aviso es del PROPIO viewer — que alguien no vea su propia publicación
 *     en su feed se lee como que no se publicó, y el primer reflejo es
 *     publicarla de nuevo.
 */

export interface RecommendedFeedScope {
  /** Entidades que el viewer sigue (`fetchFollowedListingIds`). */
  followedListingIds: readonly string[];
  /** Viewer autenticado, o null. */
  viewerId: string | null;
}

/**
 * Filtro `.or()` de PostgREST para la query de listings del tab "Para ti".
 *
 * Se devuelve un STRING y no se aplica acá para poder testearlo sin base: el
 * bug que este tipo de filtro suele tener es un `in.()` vacío, que PostgREST
 * rechaza con un 400 y se lleva puesto el feed entero.
 */
export function recommendedFeedListingFilter(scope: RecommendedFeedScope): string {
  const parts = ["tier.eq.premium"];
  if (scope.followedListingIds.length > 0) {
    parts.push(`id.in.(${scope.followedListingIds.join(",")})`);
  }
  if (scope.viewerId) {
    parts.push(`created_by.eq.${scope.viewerId}`);
  }
  return parts.join(",");
}

/**
 * La misma regla, en memoria, para cuando el conjunto ya está cargado (tests,
 * mezclas del lado del servidor). Espeja EXACTAMENTE el filtro de arriba: si
 * los dos se separan, el feed va a mostrar algo distinto de lo que dice mostrar.
 */
export function isVisibleInRecommendedFeed(
  listing: { id: string; tier?: unknown; created_by?: string | null },
  scope: RecommendedFeedScope,
): boolean {
  if (isRecommendedFeedEligible(listing.tier)) return true;
  if (scope.followedListingIds.includes(listing.id)) return true;
  if (listing.created_by && listing.created_by === scope.viewerId) return true;
  return false;
}
