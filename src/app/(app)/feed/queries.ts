import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import {
  buildTrustSignals,
  firstNameOf,
  firstPhotoUrl,
  formatListingPrice,
  toTrustLevel,
  type ListingCardModel,
  type PublisherView,
  type VerificationView,
} from "@/components/listings";
import {
  COPY,
  postKindOf,
  postMediaUrl,
  type AuthorView,
  type FeedListingModel,
  type PostCardModel,
  type PostEntityView,
} from "@/components/feed";
import { formatDate, timeAgo } from "@/lib/utils";

/**
 * Lecturas compartidas del módulo FEED (server-only). Siempre con el cliente
 * server del usuario — RLS aplica en cada query.
 *
 * VISIBILIDAD DEL FEED (feedback cliente 2026-07-19): "solo seguidores" es una
 * regla de DISTRIBUCIÓN (capa app/query), NO una frontera de seguridad RLS. Un
 * post published de una entidad sigue siendo PÚBLICO en su detalle /feed/[id] y
 * en la página de la entidad — la query del feed solo decide a quién se lo
 * MUESTRA proactivamente (seguidores + promociones). El aislamiento real lo dan
 * las policies; acá modelamos alcance, no permisos.
 */

type Supabase = SupabaseClient<Database>;

export interface PostRow {
  id: string;
  body: string;
  kind: string;
  media: string[];
  status: string;
  like_count: number;
  comment_count: number;
  created_at: string;
  author_id: string | null;
  entity_listing_id: string | null;
}

export const POST_COLUMNS =
  "id, body, kind, media, status, like_count, comment_count, created_at, author_id, entity_listing_id";

const FALLBACK_AUTHOR: AuthorView = {
  profileId: null,
  displayName: COPY.post.communityMember,
  avatarUrl: null,
  score: 0,
  level: "nuevo",
  signals: [],
};

/**
 * Resuelve en batch los AuthorView (perfil + Trust Score) de una lista de
 * profile ids. Nunca lanza: autor faltante → fallback anónimo cálido.
 */
export async function fetchAuthorViews(
  supabase: Supabase,
  profileIds: string[],
): Promise<Map<string, AuthorView>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const byId = new Map<string, AuthorView>();
  if (ids.length === 0) return byId;

  const [profilesResult, trustResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, identity_verified")
      .in("id", ids),
    supabase
      .from("trust_scores")
      .select("profile_id, score, level, signals")
      .in("profile_id", ids),
  ]);

  const trustById = new Map(
    (trustResult.data ?? []).map((row) => [row.profile_id, row]),
  );

  for (const profile of profilesResult.data ?? []) {
    const trust = trustById.get(profile.id);
    byId.set(profile.id, {
      profileId: profile.id,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      score: trust?.score ?? 0,
      level: toTrustLevel(trust?.level),
      signals: buildTrustSignals(trust?.signals ?? {}, profile.identity_verified),
    });
  }
  return byId;
}

export function authorViewOf(
  authors: Map<string, AuthorView>,
  authorId: string | null,
): AuthorView {
  return (authorId && authors.get(authorId)) || FALLBACK_AUTHOR;
}

/**
 * Ids de perfiles bloqueados por el viewer (bloqueo global, 0020_user_blocks.sql).
 * RLS de user_blocks ya limita a blocker_id = auth.uid(); el .eq es redundante
 * pero explícito, en línea con el resto del módulo. Set vacío si no hay sesión.
 */
export async function fetchBlockedIds(
  supabase: Supabase,
  viewerId: string | null,
): Promise<Set<string>> {
  if (!viewerId) return new Set();
  const { data } = await supabase
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocker_id", viewerId);
  return new Set((data ?? []).map((row) => row.blocked_id));
}

/** Ids de posts likeados por el viewer, para pintar el estado inicial del like. */
export async function fetchViewerLikes(
  supabase: Supabase,
  viewerId: string | null,
  postIds: string[],
): Promise<Set<string>> {
  if (!viewerId || postIds.length === 0) return new Set();
  const { data } = await supabase
    .from("reactions")
    .select("subject_id")
    .eq("subject_kind", "post")
    .eq("profile_id", viewerId)
    .in("subject_id", postIds);
  return new Set((data ?? []).map((row) => row.subject_id));
}

// ---------------------------------------------------------------------------
// Alcance del feed "para vos" (0023 — feedback cliente 2026-07-19)
// ---------------------------------------------------------------------------

/**
 * Ids de las ENTIDADES (listings) que el viewer sigue. Query chica y primera:
 * con estos ids se arma el `.or()` de visibilidad del feed (patrón exacto del
 * filtro de bloqueados). Vacío si no hay sesión.
 */
export async function fetchFollowedListingIds(
  supabase: Supabase,
  viewerId: string | null,
): Promise<string[]> {
  if (!viewerId) return [];
  const { data } = await supabase
    .from("follows")
    .select("target_id")
    .eq("follower_id", viewerId)
    .eq("target_kind", "listing");
  return (data ?? []).map((row) => row.target_id);
}

/**
 * Ids de posts con una promoción ACTIVA vigente en el tenant. Una campaña paga
 * lleva el post al feed de TODOS (según audience) — acá resolvemos el set para
 * (a) inyectarlo en la visibilidad y (b) marcar el chip "Publicidad".
 *
 * `audience` (scope all | zones) se guarda para segmentación geográfica futura;
 * hoy toda campaña activa alcanza a la comunidad entera (single-community).
 */
export async function fetchActivePromotedPostIds(
  supabase: Supabase,
  tenantId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("post_promotions")
    .select("post_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString());
  return new Set((data ?? []).map((row) => row.post_id));
}

/**
 * Resuelve en batch el título + vertical de las entidades de una lista de
 * posts de entidad. RLS de `listings`: los published son legibles; para el
 * dueño incluso si dejaran de estarlo, así que el autor siempre ve su cabecera.
 */
export async function fetchEntityViews(
  supabase: Supabase,
  listingIds: string[],
): Promise<Map<string, PostEntityView>> {
  const ids = [...new Set(listingIds.filter(Boolean))];
  const byId = new Map<string, PostEntityView>();
  if (ids.length === 0) return byId;
  const { data } = await supabase
    .from("listings")
    .select("id, title, kind")
    .in("id", ids);
  for (const row of data ?? []) {
    byId.set(row.id, { id: row.id, title: row.title, kind: row.kind });
  }
  return byId;
}

// ---------------------------------------------------------------------------
// Listings (los 4 tabs de kinds + los intercalados de "Para ti")
// ---------------------------------------------------------------------------

export interface ListingRow {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  price_amount: number | null;
  price_currency: string;
  price_period: string | null;
  area_label: string | null;
  photos: string[];
  created_by: string | null;
  publisher_name: string | null;
  created_at: string;
}

export const LISTING_COLUMNS =
  "id, kind, title, description, price_amount, price_currency, price_period, area_label, photos, created_by, publisher_name, created_at";

export interface ListingExtras {
  verificationByListing: Map<string, VerificationView>;
  authors: Map<string, AuthorView>;
}

/**
 * Batch de datos anexos de una página de listings: verificaciones
 * found_active (regla estricta: sin check activo no hay banda) y Trust Score
 * de los publicadores con cuenta.
 */
export async function fetchListingExtras(
  supabase: Supabase,
  tenantId: string,
  rows: ListingRow[],
  locale: string,
): Promise<ListingExtras> {
  const listingIds = rows.map((row) => row.id);
  const publisherIds = rows
    .map((row) => row.created_by)
    .filter((id): id is string => Boolean(id));

  const [checksResult, authors] = await Promise.all([
    listingIds.length > 0
      ? supabase
          .from("verification_checks")
          .select("subject_id, registry, registry_url, license_number, checked_at")
          .eq("tenant_id", tenantId)
          .eq("subject_kind", "listing")
          .eq("result", "found_active")
          .in("subject_id", listingIds)
          .order("checked_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    fetchAuthorViews(supabase, publisherIds),
  ]);

  const verificationByListing = new Map<string, VerificationView>();
  for (const check of checksResult.data ?? []) {
    if (check.subject_id && !verificationByListing.has(check.subject_id)) {
      verificationByListing.set(check.subject_id, {
        registry: check.registry,
        registryUrl: check.registry_url,
        licenseNumber: check.license_number,
        dateLabel: formatDate(check.checked_at, { locale, style: "long" }),
      });
    }
  }

  return { verificationByListing, authors };
}

/** Row property → modelo de la ListingCard real de VIVIENDA (se reutiliza tal cual). */
export function toListingCardModel(
  row: ListingRow,
  extras: ListingExtras,
  locale: string,
): ListingCardModel {
  let publisher: PublisherView = null;
  if (row.created_by) {
    const author = authorViewOf(extras.authors, row.created_by);
    publisher = {
      type: "member",
      profileId: row.created_by,
      displayName: author.displayName,
      avatarUrl: author.avatarUrl,
      score: author.score,
      level: author.level,
      signals: author.signals,
    };
  } else if (row.publisher_name) {
    publisher = { type: "external", name: row.publisher_name };
  }

  return {
    id: row.id,
    title: row.title,
    priceLabel: formatListingPrice(row.price_amount, row.price_currency, row.price_period, locale),
    areaLabel: row.area_label,
    photoUrl: firstPhotoUrl(row.photos),
    verification: extras.verificationByListing.get(row.id) ?? null,
    publisher,
  };
}

/** Row NO-property → modelo de la FeedListingCard (detalle en BottomSheet). */
export function toFeedListingModel(
  row: ListingRow,
  extras: ListingExtras,
  locale: string,
): FeedListingModel {
  const author = row.created_by ? extras.authors.get(row.created_by) : undefined;

  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    priceLabel: formatListingPrice(row.price_amount, row.price_currency, row.price_period, locale),
    areaLabel: row.area_label,
    photoUrl: firstPhotoUrl(row.photos),
    verifiedDateLabel: extras.verificationByListing.get(row.id)?.dateLabel ?? null,
    publisherName: row.publisher_name,
    publisherTrust: author
      ? {
          displayName: author.displayName,
          firstName: firstNameOf(author.displayName),
          score: author.score,
          level: author.level,
          signals: author.signals,
        }
      : null,
  };
}

export function toPostCardModel(
  row: PostRow,
  authors: Map<string, AuthorView>,
  likedIds: Set<string>,
  now: Date,
  extras?: { entity?: PostEntityView | null; isPromoted?: boolean },
): PostCardModel {
  const firstMedia = row.media.find((path) => path && path.trim().length > 0);
  return {
    id: row.id,
    kind: postKindOf(row.kind),
    body: row.body,
    // Bucket post-media (0025): el composer ya sube ahí con el cliente del user.
    photoUrl: firstMedia ? postMediaUrl(firstMedia) : null,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    createdAt: row.created_at,
    timeAgoLabel: timeAgo(row.created_at, now),
    author: authorViewOf(authors, row.author_id),
    likedByViewer: likedIds.has(row.id),
    entity: extras?.entity ?? null,
    isPromoted: extras?.isPromoted ?? false,
  };
}
