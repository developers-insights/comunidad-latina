import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import {
  buildTrustSignals,
  firstNameOf,
  firstPhotoUrl,
  formatListingPrice,
  listingPhotoUrl,
  toTrustLevel,
  type ListingCardModel,
  type PublisherView,
  type VerificationView,
} from "@/components/listings";
import {
  COPY,
  mediaKindOf,
  postKindOf,
  postMediaUrl,
  type AuthorView,
  type FeedListingModel,
  type PostCardModel,
  type PostEntityView,
  type PostMediaView,
  type PostPollView,
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
  /** posts.view_count (0038). Anulable hasta que corra el backfill. */
  view_count: number | null;
  created_at: string;
  author_id: string | null;
  entity_listing_id: string | null;
}

/** El juego de columnas que supabase-js sabe parsear HOY (sin view_count). */
type ParsablePostColumns =
  "id, body, kind, media, status, like_count, comment_count, created_at, author_id, entity_listing_id";

/**
 * El VALOR pide view_count a PostgREST; el TIPO se queda en las columnas que
 * database.types.ts ya conoce.
 *
 * view_count llega con la 0038 y los tipos se regeneran recién después: sin el
 * `as`, el parser del select marcaría la columna como inexistente y rompería
 * los `as PostRow` de TODOS los consumidores (feed, detalle, videos). El
 * contrato real de la fila lo fija `PostRow`, que sí la declara.
 * Al regenerar database.types.ts con la 0038, borrar el `as` y el alias.
 */
export const POST_COLUMNS =
  "id, body, kind, media, status, like_count, comment_count, view_count, created_at, author_id, entity_listing_id" as ParsablePostColumns;

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

/**
 * Guardados del viewer (tabla `saves`, 0038). La tabla es POLIMÓRFICA
 * (subject_kind post | listing), así que la lectura vive acá UNA vez y cada
 * vertical la reusa en lugar de duplicar la query.
 *
 * `saves` llega con la 0038 y todavía no está en database.types.ts → cliente de
 * schema abierto (mismo patrón que assistant_queries en el asistente). Nunca
 * lanza: sin sesión, sin tabla todavía o con error, el viewer ve todo como "no
 * guardado" — un guardado que no se pinta es molesto; un feed roto, no.
 */
async function fetchSavedSubjectIds(
  supabase: Supabase,
  viewerId: string | null,
  subjectKind: "post" | "listing",
  subjectIds: string[],
): Promise<Set<string>> {
  if (!viewerId || subjectIds.length === 0) return new Set();
  const open = supabase as unknown as SupabaseClient;
  const { data, error } = await open
    .from("saves")
    .select("subject_id")
    .eq("subject_kind", subjectKind)
    .eq("profile_id", viewerId)
    .in("subject_id", subjectIds);
  if (error) {
    console.warn("[feed] query de guardados falló", { code: error.code });
    return new Set();
  }
  const rows = (data ?? []) as Array<{ subject_id: string }>;
  return new Set(rows.map((row) => row.subject_id));
}

/** Ids de posts guardados por el viewer (espejo exacto de fetchViewerLikes). */
export function fetchViewerSaves(
  supabase: Supabase,
  viewerId: string | null,
  postIds: string[],
): Promise<Set<string>> {
  return fetchSavedSubjectIds(supabase, viewerId, "post", postIds);
}

// ---------------------------------------------------------------------------
// Encuestas Sí/No de las preguntas (contrato 0041)
// ---------------------------------------------------------------------------

/**
 * Encuestas de una tanda de posts + el voto DEL VIEWER en cada una.
 *
 * Query APARTE y no columnas nuevas en POST_COLUMNS a propósito: el select del
 * feed lo comparten el detalle y /videos, y una columna que todavía no existe
 * en el entorno (la 0041 puede no estar aplicada) haría fallar la consulta
 * ENTERA y con ella el feed. Acá, si el schema no está, se devuelve un mapa
 * vacío: la encuesta no se pinta y todo lo demás sigue igual.
 *
 * Los contadores salen de `posts.poll_yes_count` / `poll_no_count`, que mantiene
 * el trigger. El voto propio se lee filtrando por `voter_id = viewer`: nadie
 * puede ver el voto de otra persona (y la RLS lo re-aplica).
 */
export async function fetchPostPolls(
  supabase: Supabase,
  viewerId: string | null,
  postIds: string[],
): Promise<Map<string, PostPollView>> {
  const byPostId = new Map<string, PostPollView>();
  const ids = [...new Set(postIds.filter(Boolean))];
  if (ids.length === 0) return byPostId;

  // Schema abierto: las columnas/tabla de la 0041 todavía no están en
  // database.types.ts (mismo patrón que `saves`).
  const open = supabase as unknown as SupabaseClient;

  const { data, error } = await open
    .from("posts")
    .select("id, poll_kind, poll_yes_count, poll_no_count")
    .in("id", ids)
    .not("poll_kind", "is", null);

  if (error) {
    // Sin la migración: no hay encuestas que mostrar, no hay error que gritar.
    console.warn("[feed] query de encuestas falló", { code: error.code });
    return byPostId;
  }

  const rows = (data ?? []) as Array<{
    id: string;
    poll_kind: string | null;
    poll_yes_count: number | null;
    poll_no_count: number | null;
  }>;
  if (rows.length === 0) return byPostId;

  // Voto propio SOLO de las preguntas que sí tienen encuesta.
  const pollIds = rows.map((row) => row.id);
  const voteByPostId = new Map<string, boolean>();
  if (viewerId) {
    const { data: votes, error: voteError } = await open
      .from("post_poll_votes")
      .select("post_id, choice")
      .eq("voter_id", viewerId)
      .in("post_id", pollIds);
    if (voteError) {
      console.warn("[feed] query de votos falló", { code: voteError.code });
    } else {
      for (const vote of (votes ?? []) as Array<{ post_id: string; choice: boolean }>) {
        voteByPostId.set(vote.post_id, vote.choice);
      }
    }
  }

  for (const row of rows) {
    if (row.poll_kind !== "yes_no") continue; // formato desconocido: no se inventa UI
    byPostId.set(row.id, {
      kind: "yes_no",
      yes: row.poll_yes_count ?? 0,
      no: row.poll_no_count ?? 0,
      myVote: voteByPostId.get(row.id) ?? null,
    });
  }
  return byPostId;
}

/** Ids de avisos guardados por el viewer (detalle de propiedad/profesional/…). */
export function fetchViewerSavedListingIds(
  supabase: Supabase,
  viewerId: string | null,
  listingIds: string[],
): Promise<Set<string>> {
  return fetchSavedSubjectIds(supabase, viewerId, "listing", listingIds);
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

export interface ActivePromotions {
  /** Posts con campaña vigente: alimentan la visibilidad y el chip "Publicidad". */
  postIds: Set<string>;
  /** postId → teléfono del botón de WhatsApp que ofrece ESA campaña. */
  whatsappByPostId: Map<string, string>;
}

/**
 * Promociones ACTIVAS vigentes del tenant. Una campaña paga lleva el post al
 * feed de TODOS (según audience) — acá resolvemos el set para (a) inyectarlo en
 * la visibilidad, (b) marcar el chip "Publicidad" y (c) saber si la campaña
 * ofrece un WhatsApp de contacto (cta_whatsapp, 0038).
 *
 * `audience` (scope all | zones) se guarda para segmentación geográfica futura;
 * hoy toda campaña activa alcanza a la comunidad entera (single-community).
 *
 * cta_whatsapp llega con la 0038 y todavía no está en database.types.ts →
 * cliente de schema abierto. Si la columna aún no existe (entorno sin migrar),
 * se reintenta con la forma vieja: perder el botón de WhatsApp es aceptable,
 * perder los posts promocionados del feed no.
 */
export async function fetchActivePromotions(
  supabase: Supabase,
  tenantId: string,
): Promise<ActivePromotions> {
  const open = supabase as unknown as SupabaseClient;
  const activeQuery = (columns: string) =>
    open
      .from("post_promotions")
      .select(columns)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString());

  let { data, error } = await activeQuery("post_id, cta_whatsapp");
  if (error) {
    console.warn("[feed] campañas activas sin cta_whatsapp", { code: error.code });
    ({ data, error } = await activeQuery("post_id"));
  }

  // El cliente abierto no puede derivar la forma de la fila (el select es una
  // variable): la fijamos nosotros, que es justamente lo que pedimos arriba.
  const rows = (data ?? []) as unknown as Array<{
    post_id: string;
    cta_whatsapp?: string | null;
  }>;
  const postIds = new Set<string>();
  const whatsappByPostId = new Map<string, string>();
  for (const row of rows) {
    postIds.add(row.post_id);
    const phone = row.cta_whatsapp?.trim();
    if (phone) whatsappByPostId.set(row.post_id, phone);
  }
  return { postIds, whatsappByPostId };
}

/**
 * Solo los ids de posts promocionados. Se conserva como export propio porque es
 * lo único que necesitan los consumidores que no pintan el CTA (videos).
 */
export async function fetchActivePromotedPostIds(
  supabase: Supabase,
  tenantId: string,
): Promise<Set<string>> {
  const { postIds } = await fetchActivePromotions(supabase, tenantId);
  return postIds;
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
    // Todas las fotos: el tap sobre la foto abre el visor con la galería
    // completa también desde el feed, no solo desde /propiedades.
    photos: (row.photos ?? [])
      .filter((path) => path && path.trim().length > 0)
      .map(listingPhotoUrl),
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
  extras?: {
    entity?: PostEntityView | null;
    isPromoted?: boolean;
    /** Guardado por el viewer (fetchViewerSaves). Ausente → no guardado. */
    savedByViewer?: boolean;
    /** Encuesta Sí/No de la pregunta (fetchPostPolls). Ausente → sin encuesta. */
    poll?: PostPollView | null;
    /** WhatsApp de la campaña activa de ESTE post, si ofrece uno. */
    ctaWhatsapp?: string | null;
  },
): PostCardModel {
  // Bucket post-media (0025): fotos y videos conviven en el array `media`;
  // el kind se infiere por extensión (mediaKindOf). photoUrl queda como la
  // primera FOTO para los consumidores viejos que renderizan <img>.
  const media: PostMediaView[] = row.media
    .filter((path) => path && path.trim().length > 0)
    .map((path) => ({ kind: mediaKindOf(path), url: postMediaUrl(path) }));
  const firstPhoto = media.find((item) => item.kind === "image");
  return {
    id: row.id,
    kind: postKindOf(row.kind),
    body: row.body,
    photoUrl: firstPhoto?.url ?? null,
    media,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    // view_count es nueva (0038) y anulable hasta el backfill: 0 es el default
    // honesto para un post que todavía no acumuló vistas.
    viewCount: row.view_count ?? 0,
    createdAt: row.created_at,
    timeAgoLabel: timeAgo(row.created_at, now),
    author: authorViewOf(authors, row.author_id),
    likedByViewer: likedIds.has(row.id),
    savedByViewer: extras?.savedByViewer ?? false,
    poll: extras?.poll ?? null,
    entity: extras?.entity ?? null,
    isPromoted: extras?.isPromoted ?? false,
    ctaWhatsapp: extras?.ctaWhatsapp ?? null,
  };
}
