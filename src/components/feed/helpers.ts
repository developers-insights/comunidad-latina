import type { TrustLevel, TrustSignal } from "@/components/trust";
import type { ListingCardModel } from "@/components/listings";

/**
 * Helpers puros del módulo FEED SOCIAL. Sin dependencias de servidor:
 * usables desde Server Components y client components por igual.
 * La paginación keyset (encodeCursor/decodeCursor) se reutiliza de
 * "@/components/listings" — mismo contrato created_at|id.
 */

// ---------------------------------------------------------------------------
// Fotos de posts (bucket público post-media, 0025)
// ---------------------------------------------------------------------------

/**
 * Path de storage → URL pública del bucket post-media. Si ya es una URL
 * absoluta (seed/API), se respeta tal cual.
 *
 * El composer sube al bucket post-media con el cliente del USUARIO
 * (path {tenant_id}/{user_id}/…, policy post_media_insert 0025): terminó el
 * desvío histórico que subía a listing-photos vía admin client.
 */
export function postMediaUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/post-media/${path}`;
}

// ---------------------------------------------------------------------------
// Tabs (los 5 feeds del wireframe §4.b) — el estado vive en ?tab= (URL)
// ---------------------------------------------------------------------------

export const FEED_TABS = [
  { id: "para-ti", listingKind: null },
  { id: "propiedades", listingKind: "property" },
  { id: "negocios", listingKind: "business" },
  { id: "profesionales", listingKind: "professional" },
  { id: "eventos", listingKind: "event" },
] as const;

export type FeedTabId = (typeof FEED_TABS)[number]["id"];

export function parseTab(raw: string | undefined): FeedTabId {
  const found = FEED_TABS.find((tab) => tab.id === raw);
  return found?.id ?? "para-ti";
}

// ---------------------------------------------------------------------------
// View models que las cards reciben ya resueltos (server → UI)
// ---------------------------------------------------------------------------

/** Autor de un post/comentario con su Trust Score resuelto en batch. */
export interface AuthorView {
  profileId: string | null;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
}

/**
 * La entidad (listing) como autor visual de un post publicado COMO negocio/
 * evento/profesional/propiedad. NULL en posts personales.
 */
export interface PostEntityView {
  id: string;
  title: string;
  /** Vertical del listing: property | business | professional | event | job. */
  kind: string;
}

/** Entidad publicable elegible en el selector "Publicar como" del composer. */
export interface ComposerEntity {
  id: string;
  title: string;
  /** Vertical del listing (para el ícono/etiqueta). */
  kind: string;
}

export interface PostCardModel {
  id: string;
  kind: "post" | "question";
  body: string;
  /** URL pública de la primera foto (ya resuelta) o null. */
  photoUrl: string | null;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  timeAgoLabel: string;
  author: AuthorView;
  likedByViewer: boolean;
  /** Post publicado COMO una entidad (se muestra la entidad como autor). */
  entity: PostEntityView | null;
  /** Campaña activa (post_promotions): se marca honestamente "Publicidad". */
  isPromoted: boolean;
}

/** Listing NO-property para la card propia del feed (los property usan ListingCard). */
export interface FeedListingModel {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  priceLabel: string | null;
  areaLabel: string | null;
  photoUrl: string | null;
  verifiedDateLabel: string | null;
  publisherName: string | null;
  publisherTrust: {
    displayName: string;
    firstName: string;
    score: number;
    level: TrustLevel;
    signals: TrustSignal[];
  } | null;
}

export interface GuideCardModel {
  slug: string;
  title: string;
  summary: string | null;
  readingMinutes: number | null;
}

/** Item mixto del feed "Para ti", ya ordenado server-side por created_at desc. */
export type FeedItem =
  | { type: "post"; createdAt: string; id: string; post: PostCardModel }
  | { type: "listing-property"; createdAt: string; id: string; listing: ListingCardModel }
  | { type: "listing"; createdAt: string; id: string; listing: FeedListingModel }
  | { type: "guide"; createdAt: string; id: string; guide: GuideCardModel };

export function postKindOf(raw: string): "post" | "question" {
  return raw === "question" ? "question" : "post";
}

// ---------------------------------------------------------------------------
// Entidad (listing) como autor de un post — etiqueta, acento y link
// ---------------------------------------------------------------------------

/**
 * Metadatos de presentación por vertical de listing: etiqueta legible y la
 * variable de acento del módulo (globals.css, var(--accent-*)). El acento se
 * aplica en la card como tinte/ícono; el TEXTO queda en un token foreground
 * para no arriesgar contraste (el amarillo de negocios no es AA como texto).
 */
export const ENTITY_KIND_META: Record<
  string,
  { label: string; accentVar: string }
> = {
  property: { label: "Propiedad", accentVar: "var(--accent-vivienda)" },
  business: { label: "Negocio", accentVar: "var(--accent-negocios)" },
  professional: { label: "Profesional", accentVar: "var(--accent-profesionales)" },
  event: { label: "Evento", accentVar: "var(--accent-eventos)" },
  job: { label: "Empleo", accentVar: "var(--accent-feed)" },
};

/** Etiqueta legible del vertical, con respaldo si aparece un kind nuevo. */
export function entityKindLabel(kind: string): string {
  return ENTITY_KIND_META[kind]?.label ?? "Comunidad";
}

/** Acento del módulo para el kind (fallback al acento del feed). */
export function entityAccentVar(kind: string): string {
  return ENTITY_KIND_META[kind]?.accentVar ?? "var(--accent-feed)";
}

/**
 * Página de la entidad para el kind dado. property/professional/event tienen
 * detalle por id; business cae al directorio (no hay página por-negocio aún);
 * el resto no linkea (nombre sin link antes que un link roto).
 */
const ENTITY_DETAIL_ROUTE: Record<string, (id: string) => string> = {
  property: (id) => `/propiedades/${id}`,
  professional: (id) => `/profesionales/${id}`,
  event: (id) => `/eventos/${id}`,
  business: () => "/negocios",
};

export function entityHref(kind: string, id: string): string | null {
  return ENTITY_DETAIL_ROUTE[kind]?.(id) ?? null;
}

// ---------------------------------------------------------------------------
// Alcance del feed "para vos" (feedback cliente 2026-07-19)
// ---------------------------------------------------------------------------

/**
 * ¿Puede el viewer promocionar este post? Solo su autor (la promoción la crea
 * el server con guard de ownership + tenant; esto es el gate de la UI).
 */
export function canPromotePost(
  authorId: string | null,
  viewerId: string | null,
): boolean {
  return Boolean(authorId) && authorId === viewerId;
}

/**
 * Filtro `.or()` de PostgREST para la VISIBILIDAD de posts del feed "para vos":
 * un post entra si es personal (entity_listing_id null), si es de una entidad
 * que el viewer SIGUE, o si tiene una promoción activa (llega a todos).
 *
 * Se combina por AND con los otros `.or()` de la query (bloqueados, keyset):
 * PostgREST trata cada `.or()` como un grupo AND de nivel superior. Los ids son
 * uuids que vienen de la DB (follows/post_promotions) — no hay input de usuario
 * que interpolar, mismo patrón que el filtro de bloqueados.
 */
export function feedPostVisibilityFilter(
  followedListingIds: readonly string[],
  promotedPostIds: readonly string[],
): string {
  const parts = ["entity_listing_id.is.null"];
  if (followedListingIds.length > 0) {
    parts.push(`entity_listing_id.in.(${followedListingIds.join(",")})`);
  }
  if (promotedPostIds.length > 0) {
    parts.push(`id.in.(${promotedPostIds.join(",")})`);
  }
  return parts.join(",");
}
