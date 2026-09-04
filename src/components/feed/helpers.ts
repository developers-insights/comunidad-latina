import type { TrustLevel, TrustSignal } from "@/components/trust";
import type { ListingCardModel } from "@/components/listings";
import type { TaggedProfile } from "@/lib/social/post-tags";
import type { MusicTrackView } from "@/lib/media/audio-track";
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
  /**
   * VALOR LISTO PARA `style.filter` de ESTE medio, o vacío/ausente si no lleva
   * ninguno. Sólo lo traen los VIDEOS: la foto se publica con el filtro ya
   * quemado en los píxeles (`bake-photo.ts`), así que volver a aplicarlo acá lo
   * pintaría dos veces.
   *
   * Llega YA RESUELTO desde el servidor (`toPostCardModel` →
   * `resolvePhotoFilterCss`) y no como `{id, intensidad}` a propósito: así el
   * único lugar de toda la app que convierte un preset en CSS es el catálogo, y
   * lo que se guardó en la base —un id y un número— nunca puede llegar a un
   * `style` sin pasar por él. Un id corrupto se resuelve a cadena vacía; no hay
   * camino por el que un texto arbitrario termine siendo una regla de estilo.
   */
  filterCss?: string;
  /**
   * ---- EL VIDEO QUE VIVE EN MUX, NO EN EL BUCKET -------------------------
   *
   * `posts.mux_playback_id` y `posts.mux_status`, copiados en la diapositiva de
   * video de ese post. Van en el MEDIO y no en el modelo de la tarjeta porque
   * es quien reproduce el que los necesita, y un post puede traer fotos del
   * bucket junto a su video de Mux en el mismo carrusel.
   *
   * AUSENTES ES EL CASO NORMAL, y significa exactamente lo de siempre: este
   * medio es un archivo del bucket y se reproduce con un `<video src>`. Los 36
   * videos que ya estaban publicados caen todos acá, y todo lo que se suba
   * mientras Mux esté apagado también.
   *
   * OJO CON `url` CUANDO SÍ ESTÁN: un video de Mux NO tiene archivo en el
   * bucket, así que su `url` es la MINIATURA (`muxThumbnailUrl`), no un video.
   * Es a propósito: cualquier superficie que todavía no sepa de Mux y pinte el
   * medio como imagen muestra el primer cuadro —feo pero honesto— en vez de un
   * `<video>` con un `src` roto. Quien sí sabe, mira `muxPlaybackId` primero.
   */
  muxPlaybackId?: string | null;
  muxStatus?: string | null;
  /**
   * ---- EL PRIMER CUADRO, PARA QUE EL VIDEO NO SALGA EN BLANCO (0132) -----
   *
   * URL pública del fotograma que el navegador capturó al subir
   * (`posts.video_poster_path`). Sólo lo traen los VIDEOS del bucket.
   *
   * Existe porque el `.mp4` se sirve CRUDO: hasta que llega la metadata, el
   * `<video>` no tiene NADA que pintar, y eso es el rectángulo en blanco que
   * reportó el cliente al scrollear Videos Cortos (2026-09-03, 1:07:00). Con
   * `poster` esa espera muestra el primer cuadro del propio video.
   *
   * AUSENTE ES NORMAL y no significa "roto": los videos anteriores a la 0132 no
   * tienen ninguno, y los de Mux tampoco lo necesitan —su `url` YA es la
   * miniatura que genera Mux—. Quien pinta cae a su respaldo (nunca a blanco).
   */
  posterUrl?: string | null;
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
// Hilo de comentarios paginado (keyset) — rótulos compartidos
// ---------------------------------------------------------------------------

/**
 * Rótulos de la paginación del hilo. Los usan las DOS superficies —la hoja del
 * feed (`comments-sheet.tsx`) y el detalle `/feed/[id]`— y tienen que decir lo
 * MISMO en las dos: es la misma acción sobre el mismo hilo.
 *
 * Viven acá y no en `copy.ts` por coordinación, no por diseño: ese archivo lo
 * está tocando otro frente en esta misma tanda. MOVER a `COPY.comments` cuando
 * se pueda editar. El precedente de tener texto de UI en este módulo ya existe
 * (ENTITY_KIND_META, más abajo).
 */
export const COMMENT_THREAD_COPY = {
  /** Trae la tanda ANTERIOR (más vieja) del hilo. */
  older: "Ver comentarios anteriores",
  /** Vuelve al final del hilo, que es donde está la conversación viva. */
  newest: "Ver los más recientes",
} as const;

// ---------------------------------------------------------------------------
// Tabs (los 5 feeds del wireframe §4.b + "Siguiendo", 0119) — el estado vive en ?tab= (URL)
// ---------------------------------------------------------------------------

export const FEED_TABS = [
  // "Siguiendo" va PRIMERO (requisito del cliente, 0119): es la pregunta más
  // simple que se le hace a una red — "lo de la gente que sigo, y nada más" —
  // y hoy no tenía respuesta. "Para ti" (el algoritmo: seguidos + premium +
  // impulsado + promocionado) se queda de segundo, como default: parseTab()
  // sigue cayendo ahí, y ningún link viejo a `/feed` sin `?tab=` cambia de
  // significado.
  { id: "siguiendo", listingKind: null },
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

/**
 * ¿Este tab es un MODO del feed social ("Para ti" / "Siguiendo") y no una
 * vertical?
 *
 * Vive acá —módulo puro, sin React— y no en el componente que la estrenó
 * (`feed-mode-toggle.tsx`, que además la re-exporta para no mover su test)
 * porque hoy la preguntan DOS superficies con dos runtimes distintos: ese
 * conmutador, que es server, y la fila de círculos (`module-circles.tsx`), que
 * es cliente. Duplicar la lista de tabs sociales en las dos era garantizar que
 * el día que aparezca un tercer modo, una de las dos se entere y la otra no.
 */
export function esTabSocial(tab: FeedTabId): boolean {
  return tab === "para-ti" || tab === "siguiendo";
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
  /**
   * Primera foto de la ficha, ya resuelta a URL pública, o null. Es la CARA del
   * negocio (0116): la usan el avatar de un comentario firmado por la entidad y
   * cualquier lugar que necesite mostrarla en chico. Opcional porque la cabecera
   * de un post de entidad nunca la necesitó y no se le va a pedir de más.
   */
  photoUrl?: string | null;
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

/**
 * LO QUE EL MENÚ ⋯ NECESITA SABER de una publicación (0097), viajando dentro del
 * modelo de la tarjeta.
 *
 * Existe porque el menú se monta en DOS superficies con dos orígenes distintos:
 * el detalle `/feed/[id]`, que tiene la fila cruda de `posts` en la mano, y el
 * feed, que sólo tiene el `PostCardModel` ya armado. Sin esto, montar el menú en
 * la tarjeta pedía una segunda consulta por publicación o un modelo a medias.
 *
 * NADA DE ESTO ES UN PERMISO. Que el menú ofrezca "Fijar" no autoriza a fijar:
 * la autorización la deciden las server actions (relectura del post + autor +
 * comunidad contra el JWT) y la RLS. Acá sólo se evita ofrecer algo que va a
 * rebotar, y se elige el rótulo correcto ("Fijar" vs "Dejar de fijar").
 */
export interface PostMenuModel {
  /** `posts.author_id`. null = la cuenta ya no existe (no hay a quién reportar). */
  authorId: string | null;
  /** `published` | `pending_review` | `removed`: sólo lo publicado se administra. */
  status: string;
  /**
   * Las rutas de `posts.media` TAL CUAL están guardadas — no las URLs públicas
   * de `media`. La hoja de edición nombra los archivos que se pueden quitar por
   * su ruta; con la URL pública no podría.
   */
  mediaPaths: readonly string[];
  /** Marcas de la 0097. null = la acción está apagada. */
  pinnedAt: string | null;
  hiddenAt: string | null;
  commentsLockedAt: string | null;
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
   * FONDO ELEGIDO DE UNA PUBLICACIÓN DE TEXTO (`posts.text_background`, 0128).
   *
   * Es un id del catálogo de `@/lib/feed/text-backgrounds`, no CSS: el string
   * que sale de la base nunca se escribe en un `style`, lo resuelve
   * `textBackgroundOf` contra el catálogo cerrado.
   *
   * `null` = modo Automático (el fondo se sortea por el id del post), que es lo
   * que hacían TODAS las publicaciones antes de la 0128. Opcional —y no
   * `string | null` a secas— por el mismo motivo que las columnas de video:
   * ausente significa "esta consulta no preguntó", y en las dos situaciones la
   * tarjeta cae al sorteo, que es exactamente lo que se veía ayer.
   */
  textBackground?: string | null;
  /**
   * Teléfono del botón de WhatsApp que la campaña activa ofrece
   * (post_promotions.cta_whatsapp, 0038). null cuando el anunciante no cargó
   * ninguno o cuando el post no está promocionado.
   */
  ctaWhatsapp: string | null;
  /**
   * Personas etiquetadas en la publicación (`post_tags`, 0089). SIEMPRE
   * presente — vacío cuando no hay ninguna, nunca `undefined`: la card la
   * consume sin defensas y un opcional acá se convertiría en un `?? []`
   * repetido en cada superficie que arme un post.
   *
   * La lectura NO viaja en `POST_COLUMNS`: `post_tags` es una tabla aparte y se
   * resuelve en batch con `fetchPostTags` (una query por página, no una por
   * post), igual que los autores y las encuestas.
   */
  taggedPeople: TaggedProfile[];
  /**
   * Pista asociada a la publicación (`post_music`, 0090). `null` = la
   * publicación no tiene música — es el caso normal, así que NO es opcional:
   * mismo criterio que `taggedPeople`, la card la consume sin `?? null`
   * repetido en cada superficie que arme un post.
   *
   * `post_music` es tabla aparte (una fila por post, PK `post_id`) y se
   * resuelve en batch con `fetchPostMusic` — una query por página, no una por
   * post — igual que las encuestas y los etiquetados.
   */
  music: PostMusicView | null;
  /**
   * Insumos del menú ⋯ (0097). SIEMPRE presente —mismo criterio que
   * `taggedPeople`—: la tarjeta lo consume sin defensas y un opcional acá se
   * volvería un `?? {}` repetido en cada superficie que monte el menú.
   */
  postMenu: PostMenuModel;
}

/** Pista + recorte de UNA publicación, ya resuelta para el navegador. */
export interface PostMusicView {
  track: MusicTrackView;
  /** Segundo de la pista completa desde el que arranca el recorte publicado. */
  startSeconds: number;
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
  | {
      type: "listing";
      createdAt: string;
      id: string;
      listing: FeedListingModel;
      engagement?: import("./listing-actions").ListingEngagement;
    }
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
 * un post entra si es personal (entity_listing_id null), si es PROPIO, si es de
 * una entidad que el viewer SIGUE, o si tiene una promoción activa (llega a
 * todos).
 *
 * Se combina por AND con los otros `.or()` de la query (bloqueados, keyset):
 * PostgREST trata cada `.or()` como un grupo AND de nivel superior. Los ids son
 * uuids que vienen de la DB (follows/post_promotions) o del JWT del viewer — no
 * hay input de usuario que interpolar, mismo patrón que el filtro de bloqueados.
 *
 * ── LA CUARTA RAMA, `viewerId`, Y POR QUÉ NO ES UN LUJO ─────────────────────
 * Hasta el 2026-08-24 ninguna pantalla escribía `posts.entity_listing_id`, así
 * que esta regla existía sin ejercitarse. El día que el composer empezó a
 * firmar publicaciones con la ficha del negocio, se activó — y con ella un
 * agujero que sólo se ve cuando la regla corre de verdad: el DUEÑO del negocio
 * no sigue su propia ficha (seguirse a uno mismo no es algo que nadie haga), así
 * que su primera publicación comercial no aparecía NI EN SU PROPIO feed. Con
 * cero seguidores el día uno, eso se lee como "no se publicó", y el reflejo
 * inmediato es publicar de nuevo.
 *
 * La excepción no se inventa acá: es la MISMA tercera excepción que
 * `recommendedFeedListingFilter` (lib/monetization/feed.ts) ya hacía para los
 * avisos, con el mismo argumento escrito en su docblock. Las dos reglas de
 * alcance del feed tienen que tratar igual "lo mío": si no, el aviso propio
 * aparece y la publicación propia no, en la misma pantalla.
 *
 * Cuesta un `author_id.eq.<uuid>`: 46 bytes fijos de URL, no una lista — no
 * mueve la aguja del presupuesto de 8 KB (ver `feed/queries.ts`).
 *
 * `viewerId` es OPCIONAL para no romper a los llamadores que todavía no lo
 * pasan; sin él, el comportamiento es exactamente el de antes.
 */
export function feedPostVisibilityFilter(
  followedListingIds: readonly string[],
  promotedPostIds: readonly string[],
  viewerId?: string | null,
): string {
  const parts = ["entity_listing_id.is.null"];
  if (viewerId) {
    parts.push(`author_id.eq.${viewerId}`);
  }
  if (followedListingIds.length > 0) {
    parts.push(`entity_listing_id.in.(${followedListingIds.join(",")})`);
  }
  if (promotedPostIds.length > 0) {
    parts.push(`id.in.(${promotedPostIds.join(",")})`);
  }
  return parts.join(",");
}

/**
 * Filtro `.or()` de PostgREST para la VISIBILIDAD de posts del tab "Siguiendo"
 * (0119) — el camino legado, cuando el RPC `feed_siguiendo_posts_page` todavía
 * no existe en el entorno. Espeja CARÁCTER POR CARÁCTER las tres ramas del
 * `where` de esa función SQL (ver supabase/migrations/0119_feed_siguiendo.sql):
 * un post entra si su AUTOR es alguien que seguís, si lo firmó una FICHA que
 * seguís, o si es tuyo.
 *
 * `author_id.eq.<viewerId>` va SIEMPRE, nunca detrás de un "si hay algo que
 * seguir": la 0119 documenta por qué la rama de "lo propio" no puede depender
 * de tener follows —el dueño de un negocio no sigue su propia ficha, y sin
 * esta rama su primera publicación no aparecería en la ÚNICA pestaña donde
 * está seguro de que tendría que estar (mismo motivo que la cuarta rama de
 * `feedPostVisibilityFilter`, arriba). Por eso esta función no admite
 * "sin viewer": a "Siguiendo" no se entra sin sesión (ver 0119 §3), así que
 * `viewerId` es un string, no un opcional.
 */
export function siguiendoPostVisibilityFilter(
  followedProfileIds: readonly string[],
  followedListingIds: readonly string[],
  viewerId: string,
): string {
  const parts: string[] = [];
  if (followedProfileIds.length > 0) {
    parts.push(`author_id.in.(${followedProfileIds.join(",")})`);
  }
  if (followedListingIds.length > 0) {
    parts.push(`entity_listing_id.in.(${followedListingIds.join(",")})`);
  }
  parts.push(`author_id.eq.${viewerId}`);
  return parts.join(",");
}

/**
 * La misma idea del lado de los AVISOS: espeja `feed_siguiendo_listings_page`
 * (0119) — publicado por un perfil que seguís, o la ficha misma si la seguís.
 *
 * A diferencia de la de arriba, ACÁ SÍ puede no haber nada que preguntar: la
 * 0119 es explícita en que los avisos NO tienen rama de "lo propio" ("Mis
 * publicaciones" ya cubre eso), así que con las dos listas vacías no existe
 * ninguna condición que un aviso pueda cumplir. Devolver `null` en ese caso
 * —en vez de un `.or()` que no matchea nunca— es lo que le permite al
 * llamador (`load-more.ts`) saltear la consulta entera: un `in.()` vacío
 * PostgREST lo rechaza con 400 (ver `recommendedFeedListingFilter`), así que
 * "nada que preguntar" tiene que cortar ANTES de armar el filtro, no adentro.
 */
export function siguiendoListingVisibilityFilter(
  followedProfileIds: readonly string[],
  followedListingIds: readonly string[],
): string | null {
  const parts: string[] = [];
  if (followedProfileIds.length > 0) {
    parts.push(`created_by.in.(${followedProfileIds.join(",")})`);
  }
  if (followedListingIds.length > 0) {
    parts.push(`id.in.(${followedListingIds.join(",")})`);
  }
  return parts.length > 0 ? parts.join(",") : null;
}

/**
 * Copy de los DOS vacíos del tab "Siguiendo" (0119) — no son una variación del
 * mismo texto, son dos problemas distintos: sin sesión el problema es "no
 * entraste todavía" (se resuelve entrando); con sesión y sin nada que ver el
 * problema es "no elegiste a nadie" (se resuelve siguiendo). Confundirlos
 * manda a iniciar sesión a alguien que ya inició sesión.
 *
 * Vive ACÁ y no en `copy.ts` por el mismo motivo que `COMMENT_THREAD_COPY`
 * (arriba de este archivo): coordinación con otro frente que puede estar
 * tocando ese archivo en la misma tanda, no una decisión de diseño. MOVER a
 * `COPY.feed` (mismo prefijo que `emptyParaTi*`/`emptyListings*`) cuando se
 * pueda editar sin pisar a nadie.
 */
export const SIGUIENDO_EMPTY_COPY = {
  anonTitle: "Seguí a tu gente",
  anonMessage:
    "Con tu cuenta vas a ver acá las publicaciones y los avisos de la gente, los negocios y los profesionales que sigas.",
  anonCta: "Entrá a tu cuenta",
  noFollowsTitle: "Todavía no hay nada de lo que seguís",
  noFollowsMessage:
    "Seguí a más vecinos, negocios o profesionales de tu comunidad — sus publicaciones y sus avisos van a aparecer acá.",
  noFollowsCtaBusinesses: "Explorar negocios",
  noFollowsCtaProfessionals: "Explorar profesionales",
} as const;

/**
 * Filtro `.or()` de PostgREST para la ZONA de los posts del feed (0115).
 *
 * Un post entra si es de una de las etiquetas de la zona elegida, o si tiene
 * una campaña que compró llegar hasta acá (`promotedPostIds` ya viene filtrado
 * por `campanaAlcanzaZona`, no es "toda campaña activa"). Es el espejo exacto
 * de la rama ZONA de `feed_posts_page`: si los dos caminos no dijeran lo mismo,
 * el feed cambiaría de contenido según qué entorno tenga la migración.
 *
 * Devuelve `null` cuando NO hay que filtrar (sin zona elegida). Nunca devuelve
 * un filtro que no matchee nada: `zonasCoincidentes` garantiza al menos una
 * etiqueta cuando hay zona, y confundir "no filtres" con "no hay nada" deja el
 * feed en blanco.
 *
 * Las etiquetas son texto libre de la gente ("Corona, Queens" trae una coma,
 * que en PostgREST es el separador de la lista), así que van entrecomilladas y
 * escapadas — ver `postgrestQuoted`.
 */
export function feedZoneFilter(
  areaLabels: readonly string[],
  promotedPostIds: readonly string[] = [],
): string | null {
  if (areaLabels.length === 0) return null;
  const parts = [`area_label.in.(${areaLabels.map(postgrestQuoted).join(",")})`];
  if (promotedPostIds.length > 0) {
    parts.push(`id.in.(${promotedPostIds.join(",")})`);
  }
  return parts.join(",");
}

/**
 * Un valor listo para entrar en una lista `in.(…)` de PostgREST.
 *
 * PostgREST separa por comas y corta el grupo con `)`, así que cualquier valor
 * que traiga una coma, un paréntesis o comillas tiene que viajar entrecomillado
 * con las comillas internas escapadas. Los `area_label` son exactamente ese
 * caso: los escribe la gente y la mitad de esta comunidad los escribe con coma.
 */
export function postgrestQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
