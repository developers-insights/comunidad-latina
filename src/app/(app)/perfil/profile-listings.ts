import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import {
  fetchListingExtras,
  LISTING_COLUMNS,
  toFeedListingModel,
  toListingCardModel,
  type ListingRow,
} from "@/app/(app)/feed/queries";
import type { ListingCardModel } from "@/components/listings";
import type { FeedListingModel } from "@/components/feed";

/**
 * =============================================================================
 * PESTAÑA "AVISOS" DEL PERFIL — los listings que esta persona publicó
 * =============================================================================
 *
 * Requisito del cliente: un evento o aviso publicado tiene que verse en la
 * página de quien lo publicó. Hasta esta pestaña, el perfil no listaba nada de
 * `listings` — sólo publicaciones (`posts`).
 *
 * TODOS LOS KINDS a propósito, sin filtrar por `kind`: una persona puede
 * publicar una propiedad, un evento, un empleo, un producto… y todos son
 * igual de "suyos". El filtro real es `created_by = <perfil>` AND
 * `status = 'published'`.
 *
 * ── REUSA LA CAPA DEL FEED, NO LA REINVENTA ──────────────────────────────────
 * `toListingCardModel` / `toFeedListingModel` / `fetchListingExtras` son
 * EXACTAMENTE las funciones que `app/(app)/feed/queries.ts` usa para armar
 * estos mismos avisos cuando aparecen en el feed (verificación `found_active` +
 * Trust Score del publicador, ya resueltos en batch — sin eso, cada aviso acá
 * mostraría "sin verificar" aunque lo esté). Este archivo sólo las IMPORTA — no
 * las edita, no las copia — para que un aviso se vea y se comporte IGUAL esté
 * donde esté: la ficha de vivienda usa `ListingCard` (kind='property'), el
 * resto usa `FeedListingCard`, ambas ya escritas, probadas y en uso.
 *
 * ── ORDEN: por `published_at`, no por `starts_at` ────────────────────────────
 * Se decidió "más reciente primero" (`published_at desc`), el mismo criterio
 * que `fetchPuestosDelNegocio` (lib/negocios/empleos.ts). NO se ordena por
 * `starts_at` (la fecha del evento): esta pestaña MEZCLA kinds, y la mayoría
 * (propiedad, empleo, producto…) no tiene esa fecha — ordenar la pestaña entera
 * por un campo que casi ningún aviso tiene dejaría los eventos arriba o abajo
 * sin ningún criterio para el resto. Ordenar por `starts_at` sólo tiene sentido
 * cuando la lista es SÓLO de eventos (ver `lib/negocios/eventos.ts`).
 *
 * ── TOPE de 20, sin paginación ────────────────────────────────────────────────
 * Mismo criterio que `fetchProfileReviews`: es una pestaña de perfil, no un
 * listado que crece sin fin. Si hace falta "Ver más" más adelante, es un
 * cambio localizado a este archivo (cursor keyset sobre `published_at, id`,
 * igual que ya hace `fetchAuthorPostTiles` para Fotos/Videos).
 */

const PROFILE_LISTINGS_LIMIT = 20;

export type ProfileListingItem =
  | { kind: "property"; listing: ListingCardModel }
  | { kind: "other"; listing: FeedListingModel };

export async function fetchProfileListings(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; profileId: string; locale: string },
): Promise<ProfileListingItem[]> {
  const { tenantId, profileId, locale } = args;

  const { data, error } = await supabase
    .from("listings")
    .select(LISTING_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("created_by", profileId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PROFILE_LISTINGS_LIMIT);

  if (error) {
    // Tolerante: la pestaña cae al estado vacío en vez de tirar abajo el
    // perfil entero — mismo criterio que el resto de profile-data.ts.
    console.warn("[perfil] query de avisos falló", { code: error.code });
    return [];
  }

  const rows = (data ?? []) as ListingRow[];
  if (rows.length === 0) return [];

  // UNA sola ida por los datos anexos (verificación + Trust Score) para TODA
  // la página, sin importar cuántos avisos haya — no una consulta por fila.
  const extras = await fetchListingExtras(supabase, tenantId, rows, locale);

  return rows.map((row) =>
    row.kind === "property"
      ? { kind: "property" as const, listing: toListingCardModel(row, extras, locale) }
      : { kind: "other" as const, listing: toFeedListingModel(row, extras, locale) },
  );
}
