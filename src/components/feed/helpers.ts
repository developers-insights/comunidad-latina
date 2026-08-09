import type { TrustLevel, TrustSignal } from "@/components/trust";
import type { ListingCardModel } from "@/components/listings";
import { playbackCapSeconds } from "@/lib/media/video-policy";

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
// Media de posts: fotos Y videos en el mismo array posts.media (0025)
// ---------------------------------------------------------------------------

export type PostMediaKind = "image" | "video";

/** Un elemento del carrusel de un post, con su URL pública ya resuelta. */
export interface PostMediaView {
  kind: PostMediaKind;
  url: string;
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

/**
 * El bucket post-media guarda fotos y videos en el mismo array `posts.media`
 * sin columna de tipo: el kind se infiere por extensión del path. Suficiente
 * porque el composer controla las extensiones que sube.
 */
export function mediaKindOf(path: string): PostMediaKind {
  return VIDEO_EXT_RE.test(path) ? "video" : "image";
}

/**
 * Los medios VISIBLES de un post, en orden de publicación: exactamente las
 * diapositivas que va a tener el carrusel.
 *
 * Normaliza acá —y en un solo lugar— el `photoUrl` retrocompat de los posts
 * anteriores a la migración 0025 (una única foto; nunca un video). La card lo
 * llama UNA vez y reparte el resultado: el carrusel decide qué pinta y las
 * acciones deciden sobre qué se abre la hoja de comentarios. Si cada pieza
 * volviera a resolver "¿media o photoUrl?" por su cuenta, podrían discrepar.
 */
export function postMediaItems(
  media: PostMediaView[],
  photoUrl: string | null,
): PostMediaView[] {
  if (media.length > 0) return media;
  return photoUrl ? [{ kind: "image", url: photoUrl }] : [];
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

/**
 * Scope de video que una card recibe de quien la monta: o un tab del feed —y el
 * toque abre el reel acotado a ese vertical— o `"sin-reel"`, que abre el visor
 * del propio post y no lleva a ningún lado (feedback cliente 2026-07-27: dentro
 * de una propiedad o un evento el video no puede sacarte de la publicación).
 *
 * Está tipado y no es `string` a propósito. Con `string`, montar `PostCard` en
 * una sección nueva con un scope inventado compilaba, y el reel caía al default
 * "para-ti" —que NO filtra— mostrando el catálogo entero en silencio. Ahora eso
 * es un error de compilación en el punto de montaje.
 *
 * El literal `"sin-reel"` tiene su constante en runtime en `card-video.tsx`
 * (`NO_REEL_SCOPE`), anclada por test; acá va el literal porque este módulo es
 * puro y no puede importar de un componente cliente sin crear un ciclo.
 */
export type VideoScopeProp = FeedTabId | "sin-reel";

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

/**
 * ENCUESTA SÍ/NO de una pregunta (contrato de la migración 0041).
 *
 * `yes`/`no` son los contadores DENORMALIZADOS que mantiene el trigger
 * (`posts.poll_yes_count` / `posts.poll_no_count`): la UI los LEE, nunca los
 * escribe. `myVote` sale de leer SOLO la fila del usuario actual en
 * `post_poll_votes` — nadie puede ver el voto de otro.
 */
export interface PostPollView {
  /** Único formato por ahora; el check de la DB solo acepta 'yes_no'. */
  kind: "yes_no";
  yes: number;
  no: number;
  /** true = votó Sí · false = votó No · null = todavía no votó. */
  myVote: boolean | null;
}

/** Porcentaje entero de una opción sobre el total (0 si nadie votó todavía). */
export function pollPercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export interface PostCardModel {
  id: string;
  kind: "post" | "question" | "text";
  body: string;
  /** URL pública de la primera FOTO (ya resuelta) o null — retrocompat. */
  photoUrl: string | null;
  /** Todos los medios del post (fotos y videos) en orden de publicación. */
  media: PostMediaView[];
  likeCount: number;
  commentCount: number;
  createdAt: string;
  timeAgoLabel: string;
  author: AuthorView;
  likedByViewer: boolean;
  /** Guardado por el viewer (tabla `saves`, 0038). false para anónimos. */
  savedByViewer: boolean;
  /** Vistas acumuladas del post (posts.view_count, 0038). 0 si todavía ninguna. */
  viewCount: number;
  /**
   * Encuesta Sí/No de la pregunta (0041). null cuando el post no es pregunta,
   * cuando la pregunta se publicó sin encuesta, o cuando el entorno todavía no
   * tiene la migración aplicada (la lectura falla en silencio: una encuesta que
   * no se pinta es molesta; un feed roto, no).
   */
  poll: PostPollView | null;
  /** Post publicado COMO una entidad (se muestra la entidad como autor). */
  entity: PostEntityView | null;
  /** Campaña activa (post_promotions): se marca honestamente "Patrocinado". */
  isPromoted: boolean;
  /**
   * COLUMNAS DE VIDEO (migración 0046). OPCIONALES a propósito: las resuelve
   * quien las necesita —hoy el reel de Videos Cortos, que es la superficie
   * donde un error deja entrar un video de 10 minutos— y el feed general sigue
   * armando su modelo sin pedirlas. Ausentes ≠ falsas: significan "esta
   * consulta no preguntó", y por eso `isEligibleForShortFeed` exige
   * `video_type === 'short_video'` en positivo en vez de descartar por negación.
   */
  videoType?: string | null;
  /** posts.duration_seconds. null = DESCONOCIDA (no "corta"): ver 0049. */
  durationSeconds?: number | null;
  /** posts.is_paid_ad — publicidad paga, se marca "Patrocinado". */
  isPaidAd?: boolean;
  /** posts.eligible_for_short_feed — VETO del scroll, no afirmación. */
  eligibleForShortFeed?: boolean;
  /** posts.video_category — catálogo cerrado del menú de Videos Cortos. */
  videoCategory?: string | null;
  /**
   * Teléfono del botón de WhatsApp que la campaña activa ofrece
   * (post_promotions.cta_whatsapp, 0038). null cuando el anunciante no cargó
   * ninguno o cuando el post no está promocionado.
   */
  ctaWhatsapp: string | null;
}

// ---------------------------------------------------------------------------
// Publicidad paga: qué se marca "Patrocinado" y qué se mira DENTRO del anuncio
// ---------------------------------------------------------------------------

/** Lo mínimo que hay que saber de un post para responder las dos preguntas. */
export interface PaidAdSubject {
  /** posts.video_type (0046). 'advertising_video' = video de una campaña. */
  videoType?: string | null;
  /** posts.is_paid_ad (0046) — columna blindada, la escribe el servidor. */
  isPaidAd?: boolean;
  /** Campaña VIGENTE en post_promotions (0038). Cambia con el calendario. */
  isPromoted?: boolean;
}

/**
 * ¿Este post es un espacio PAGO? Tres señales, unidas por OR, y hace falta que
 * sean las tres porque miden cosas distintas:
 *
 *  · `isPromoted` es la campaña VIGENTE (post_promotions). Se apaga sola cuando
 *    la campaña termina — por eso NO alcanza: el post sigue siendo el anuncio
 *    que fue, y su video largo sigue existiendo.
 *  · `isPaidAd` es la columna de la 0046, blindada contra escritura directa
 *    (`app.protect_post_counters`). Es permanente y es la que manda.
 *  · `videoType === 'advertising_video'` es la misma verdad dicha por el tipo.
 *    Se mira igual por si una fila vieja quedó con la bandera sin el tipo, o al
 *    revés: entre "de más" y "de menos", en divulgación de publicidad se marca
 *    de más.
 *
 * De acá salen las DOS consecuencias, y a propósito de la misma función: el
 * chip "Patrocinado" y el ruteo del video. Que un anuncio se marque pero se
 * comporte como contenido orgánico (o al revés) es justamente el bug.
 */
export function isPaidAdvertising(post: PaidAdSubject): boolean {
  if (post.isPromoted === true) return true;
  if (post.isPaidAd === true) return true;
  return post.videoType === "advertising_video";
}

/**
 * ¿El video de este post ABRE EL REEL al tocarlo, o se queda en su publicación?
 *
 * Devuelve `false` —no hay reel— por dos motivos que terminan igual: el video
 * se abre a pantalla completa SOBRE esta misma publicación y al cerrar volvés
 * exactamente a donde estabas.
 *
 *  1. La pantalla muestra UNA publicación (`scope === 'sin-reel'`): el detalle,
 *     al que se llega desde el perfil de alguien o desde las novedades de un
 *     evento (feedback cliente 2026-07-27: "no lo puedes scrollear porque te
 *     sale de la propiedad").
 *  2. Es un espacio PAGO. Mandar a quien tocó un anuncio al scroll infinito lo
 *     lleva lejos de lo que el anunciante pagó por mostrar; y encima el video
 *     publicitario NO está en el reel (contrato 0046), así que sería un scroll
 *     donde ese video, por definición, no existe. Es el bug que el cliente
 *     reportó en la call del 29/7 (1:19) para propiedades y eventos.
 */
export function videoOpensReel(input: {
  scope: VideoScopeProp;
  post: PaidAdSubject;
}): boolean {
  if (input.scope === "sin-reel") return false;
  return !isPaidAdvertising(input.post);
}

/**
 * Segundos que el visor a pantalla completa reproduce de ESTE post. Los números
 * no se escriben acá: salen de `playbackCapSeconds` (video-policy), que es el
 * único lugar donde viven los cuatro topes.
 *
 *  · anuncio  → 600 s (el video publicitario completo, dentro de su anuncio).
 *  · el resto → 300 s (el video completo de una publicación en su detalle).
 *
 * Que el segundo tenga tope y no sea "infinito" importa por los 7 videos
 * anteriores a la 0046: su `duration_seconds` es DESCONOCIDA, así que el
 * archivo puede durar cualquier cosa. El tope es lo que hace que la promesa de
 * la superficie no dependa de un dato que no tenemos.
 */
export function viewerPlaybackCapFor(post: PaidAdSubject): number {
  return playbackCapSeconds(isPaidAdvertising(post) ? "advertising" : "detail");
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
    /** Perfil de quien publica — la hoja del Trust Score ofrece "Ver perfil". */
    profileId: string | null;
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

export function postKindOf(raw: string): "post" | "question" | "text" {
  if (raw === "question") return "question";
  if (raw === "text") return "text";
  return "post";
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
  job: { label: "Empleo", accentVar: "var(--accent-empleos)" },
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
 * Página de la entidad para el kind dado. Los cinco verticales tienen detalle
 * por id; un kind desconocido no linkea (nombre sin link antes que link roto).
 *
 * `business` apuntaba al directorio entero porque no existía página por-negocio
 * — el nombre del negocio en un post te dejaba en la lista de todos. Desde el
 * 2026-07-30 existe `/negocios/[id]` (call del 29/7, 1:05) y linkea al negocio.
 */
const ENTITY_DETAIL_ROUTE: Record<string, (id: string) => string> = {
  property: (id) => `/propiedades/${id}`,
  professional: (id) => `/profesionales/${id}`,
  event: (id) => `/eventos/${id}`,
  job: (id) => `/empleos/${id}`,
  business: (id) => `/negocios/${id}`,
};

export function entityHref(kind: string, id: string): string | null {
  return ENTITY_DETAIL_ROUTE[kind]?.(id) ?? null;
}

// ---------------------------------------------------------------------------
// WhatsApp de una campaña paga (post_promotions.cta_whatsapp, 0038)
// ---------------------------------------------------------------------------

/**
 * Link `wa.me` a partir de un teléfono escrito como sea ("+1 (305) 555-0134"):
 * wa.me solo entiende dígitos, sin `+` ni separadores. Devuelve null si lo que
 * quedó no es un número plausible (8 a 15 dígitos, el rango de E.164) — antes
 * un botón ausente que uno que abre WhatsApp en un número roto.
 */
export function whatsappHref(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}`;
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
