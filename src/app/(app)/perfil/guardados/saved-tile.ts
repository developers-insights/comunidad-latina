import { firstPhotoUrl, formatListingPrice } from "@/components/listings";
import { toPostTile, type PostTile } from "../post-tiles";

/**
 * Modelo PURO de un ítem de "Guardados" (§ perfil). Un guardado es post o
 * listing (tabla `saves`, polimórfica — 0038); acá se unifican en una sola fila
 * cronológica por fecha de guardado.
 *
 * Sin imports de servidor a propósito: se importa desde la query server-only
 * (saved-items.ts) y desde su test en entorno node — mismo patrón que
 * post-tiles.ts. `@/components/listings` (firstPhotoUrl/formatListingPrice) es
 * puro igual que `@/components/feed/helpers`, así que este módulo tampoco
 * arrastra jsdom.
 */

// ---------------------------------------------------------------------------
// Listings guardables HOY: los 5 kinds cuyo detalle tiene botón de guardar
// (DetailTopBar, ver src/components/listings/detail-top-bar.tsx). 'business' y
// 'creator_gig' también existen como listings.kind pero sus páginas de detalle
// no ofrecen "guardar" todavía — si apareciera un guardado huérfano de esos
// kinds (dato viejo o featureflag futuro), preferimos OMITIR el ítem antes que
// armar un link a una ruta que no existe.
// ---------------------------------------------------------------------------
const LISTING_KIND_PATH: Record<string, string> = {
  property: "/propiedades",
  professional: "/profesionales",
  event: "/eventos",
  job: "/empleos",
  product: "/marketplace",
};

const LISTING_KIND_LABEL: Record<string, string> = {
  property: "Vivienda",
  professional: "Profesional",
  event: "Evento",
  job: "Empleo",
  product: "Producto",
};

/** href de detalle del listing, o null si su `kind` no tiene ruta pública hoy. */
export function listingHref(kind: string, id: string): string | null {
  const base = LISTING_KIND_PATH[kind];
  return base ? `${base}/${id}` : null;
}

/** Etiqueta corta del tipo de aviso para la meta-línea de la fila. */
export function listingKindLabel(kind: string): string {
  return LISTING_KIND_LABEL[kind] ?? "Aviso";
}

/** Fila mínima de `listings` que necesita la fila de guardados. */
export interface SavedListingInput {
  id: string;
  kind: string;
  title: string;
  price_amount: number | null;
  price_currency: string;
  price_period: string | null;
  area_label: string | null;
  photos: string[] | null;
}

export interface SavedListingTile {
  id: string;
  /** kind crudo ('property' | 'professional' | 'event' | 'job' | 'product') — para elegir ícono de fallback en la fila. */
  kind: string;
  href: string;
  kindLabel: string;
  title: string;
  priceLabel: string | null;
  areaLabel: string | null;
  photoUrl: string | null;
}

/**
 * Fila de listing guardado → tile, o `null` si el kind no tiene ruta pública
 * (ver LISTING_KIND_PATH). El caller debe omitir el ítem cuando da null — nunca
 * un link roto.
 */
export function toSavedListingTile(input: SavedListingInput): SavedListingTile | null {
  const href = listingHref(input.kind, input.id);
  if (!href) return null;
  return {
    id: input.id,
    kind: input.kind,
    href,
    kindLabel: listingKindLabel(input.kind),
    title: input.title,
    priceLabel: formatListingPrice(input.price_amount, input.price_currency, input.price_period),
    areaLabel: input.area_label,
    photoUrl: firstPhotoUrl(input.photos),
  };
}

// ---------------------------------------------------------------------------
// Ítem unificado de la lista (post | listing), en el orden cronológico de
// `saves.created_at` que ya trae la query.
// ---------------------------------------------------------------------------
export type SavedItem =
  | { key: string; subjectKind: "post"; post: PostTile }
  | { key: string; subjectKind: "listing"; listing: SavedListingTile };

// Re-exportado por conveniencia: quien renderiza la fila de post no necesita
// otro import para el tipo del tile.
export type { PostTile };
export { toPostTile };
