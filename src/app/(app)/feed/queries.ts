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
  type PostMusicView,
  type PostPollView,
} from "@/components/feed";
import { mediaFilterCssByPath } from "@/lib/media/photo-filters";
import { MUX_FILTER_KEY, muxThumbnailUrl, parseMuxStatus } from "@/lib/media/mux-video";
import { zonasDeCampana, type ZonasDeCampana } from "@/lib/zona/campanas";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { timeAgo } from "@/lib/utils";
import type { TaggedProfile } from "@/lib/social/post-tags";
import {
  MUSIC_CATEGORIES,
  MUSIC_LICENSE_KINDS,
  musicTrackUrl,
  type MusicCategory,
  type MusicLicenseKind,
} from "@/lib/media/audio-track";

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

// ---------------------------------------------------------------------------
// EL PRESUPUESTO DE 8 KB DE LA URL (por qué estas lecturas llevan tope)
// ---------------------------------------------------------------------------

/**
 * Las lecturas de supabase-js son **GET**: todo `.in(…)` y todo `.or(…in.(…))`
 * viaja en el QUERYSTRING, no en un body. Medido con el propio postgrest-js de
 * este repo, cada uuid de una lista cuesta ~39 bytes de URL (36 del uuid + la
 * coma, que se serializa `%2C`). Kong y nginx cortan el request line alrededor
 * de los 8 KB y responden **414**.
 *
 * Lo grave del 414 no es que falle: es A QUIÉN le falla. La lista de campañas
 * activas es del TENANT, no del usuario — cuando cruza el umbral, el feed deja
 * de responder para TODOS a la vez. O sea: el negocio de publicidad funcionando
 * rompería el producto. Por eso las tres lecturas que alimentan esos filtros
 * (campañas, seguidos y bloqueados) llevan tope explícito: sin él, el límite no
 * lo pone el código sino el crecimiento del producto.
 *
 * LOS TRES TOPES COMPARTEN UNA SOLA URL, y sumados NO entran en 8 KB
 * (150 + 200 + 200 ids ≈ 21 KB). No son la solución: son la cota que vuelve la
 * falla acotada y predecible en lugar de abierta.
 *
 * ── LA SOLUCIÓN YA ESTÁ ESCRITA: `feed-rpc.ts` ──────────────────────────────
 * `feed_posts_page()` / `feed_listings_page()` resuelven la página CONTRA
 * follows / post_promotions / user_blocks adentro de Postgres, y por la URL no
 * viaja un solo id. `loadParaTiPage` (load-more.ts) ya las llama primero y sólo
 * cae a este camino cuando el RPC todavía no existe en el entorno.
 *
 * Resultó `security invoker`, no `definer` como decía esta nota: con invoker las
 * policies se siguen evaluando sobre el JWT de quien pregunta, así que el RPC no
 * puede devolver una fila que la query de hoy no devolvería — mover el filtro de
 * lugar y mover la frontera de seguridad son dos cosas distintas, y sólo una
 * estaba rota. Mismo criterio que `global_search()` (0044/0052). El porqué
 * completo está en el encabezado de `feed-rpc.ts`.
 *
 * Mientras el fallback siga existiendo, estos números NO se suben: subirlos es
 * acercar el 414, no dar más alcance. Cuando la migración esté en todos los
 * entornos, lo que se borra es el fallback (y con él estas tres constantes), no
 * los topes.
 */

/** Campañas vigentes que se inyectan en la visibilidad (~5,8 KB de URL). */
const ACTIVE_PROMOTIONS_CAP = 150;

/** Entidades seguidas que se inyectan en la visibilidad (~7,8 KB de URL). */
const FOLLOWED_LISTINGS_CAP = 200;

/** Perfiles bloqueados que se inyectan en el `not.in.(…)` (~7,8 KB de URL). */
const BLOCKED_PROFILES_CAP = 200;

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
  /**
   * COLUMNAS DE VIDEO (0046) — viajan con TODA fila de post, no sólo con las del
   * reel. Fue el agujero del 2026-07-30: el feed sólo sabía de `isPromoted`
   * (campaña VIGENTE en post_promotions), así que un `advertising_video` cuya
   * campaña ya había terminado seguía siendo, para la tarjeta, un video
   * cualquiera — y tocarlo abría el scroll de Videos Cortos, donde ese video
   * por contrato no existe. Con la columna a la vista, la tarjeta decide por lo
   * que el post ES y no por lo que su campaña está haciendo hoy.
   */
  video_type: string | null;
  /** posts.duration_seconds. null = DESCONOCIDA (no "corta"): ver 0049. */
  duration_seconds: number | null;
  /** posts.is_paid_ad — publicidad paga. Se marca "Patrocinado" y no va al reel. */
  is_paid_ad: boolean | null;
  /** posts.eligible_for_short_feed — VETO del scroll, no afirmación. */
  eligible_for_short_feed: boolean | null;
  /** posts.video_category — catálogo cerrado del menú de Videos Cortos. */
  video_category: string | null;
  /**
   * LAS TRES MARCAS DEL MENÚ ⋯ (0097). Viajan con toda fila de post por el mismo
   * motivo que las de video: la decisión que habilitan —qué ofrece el menú y qué
   * rótulo lleva cada fila— la toma un componente que se monta en varias
   * superficies, y un select que las pidiera sólo en una dejaría a las otras
   * decidiendo con datos que no tienen. Son tres columnas escalares.
   */
  pinned_at: string | null;
  hidden_at: string | null;
  comments_locked_at: string | null;
  /**
   * FILTRO DE PRESENTACIÓN POR ARCHIVO (0104). Objeto `{ruta: {id, intensity}}`
   * — hoy sólo lo llevan los VIDEOS: la foto se publica con el filtro ya quemado
   * en los píxeles y volver a aplicarlo al pintar lo mostraría dos veces.
   *
   * `unknown` a propósito: es jsonb, o sea que lo que vuelve de la base es lo
   * que alguien escribió alguna vez. Se lo lee con `mediaFilterCssByPath`, que
   * valida contra el catálogo y devuelve CSS del catálogo o nada — nunca lo que
   * diga la fila. Opcional porque una consulta que no la pida (o una fila
   * anterior a la 0104) significa "sin filtros", que es la verdad.
   */
  media_filters?: unknown;
  /**
   * ---- EL VIDEO EN MUX (columnas nuevas) ---------------------------------
   *
   * Un video subido por Mux NO deja archivo en el bucket: `posts.media` viene
   * sin ninguna ruta de video y todo lo que se sabe de él está en estas dos
   * columnas. Por eso viajan con TODA fila de post, igual que las de video de
   * la 0046 y por el mismo motivo: la decisión que habilitan —¿esta tarjeta
   * pinta un reproductor, un estado de "preparando", o el `<video>` de
   * siempre?— la toma un componente que se monta en el feed, en el detalle, en
   * el reel y en el perfil. Una consulta que las pidiera sólo en una superficie
   * dejaría a las otras mostrando una publicación sin medio.
   *
   * Opcionales porque una base donde la migración de Mux todavía no corrió las
   * devuelve ausentes, y ausente significa "este post no pasó por Mux" — que es
   * la verdad para los 36 videos anteriores.
   */
  mux_playback_id?: string | null;
  mux_status?: string | null;
}

/**
 * Filtro PostgREST que saca del listado lo que su autor OCULTÓ (0097).
 *
 * Va como string de `.or()` y no como `.is("hidden_at", null)` por una razón
 * concreta: `hidden_at` todavía no está en `database.types.ts` (se regenera
 * aparte) y `.is()` sobre una columna que el tipo no conoce no compila. `.or()`
 * recibe texto crudo, así que atraviesa el tipado sin castear el cliente entero.
 * Un `.or()` de un solo término es un AND más, y PostgREST AND-ea cada `.or()`
 * de nivel superior con los otros (visibilidad, bloqueados, keyset).
 *
 * ESTÁ ACÁ Y NO REPETIDO EN CADA QUERY para que sea UNA sola definición de "qué
 * es una publicación visible". Lo usan el feed (`load-more.ts`), el scroll de
 * Videos Cortos (`videos/queries.ts`) y el grid del perfil (`perfil/posts.ts`):
 * las tres superficies de descubrimiento. El detalle `/feed/[id]` NO lo usa, y
 * es deliberado — ocultar del feed no rompe el link que alguien ya compartió
 * (ver el punto 2 de la cabecera de la 0097).
 */
export const VISIBLE_POSTS_FILTER = "hidden_at.is.null";

/** El juego de columnas que supabase-js sabe parsear HOY (sin view_count). */
type ParsablePostColumns =
  "id, body, kind, media, status, like_count, comment_count, created_at, author_id, entity_listing_id";

/**
 * El VALOR pide view_count y las columnas de video a PostgREST; el TIPO se
 * queda en las columnas que database.types.ts ya conoce.
 *
 * view_count llega con la 0038 y las de video con la 0046; los tipos se
 * regeneran recién después: sin el `as`, el parser del select marcaría esas
 * columnas como inexistentes y rompería los `as PostRow` de TODOS los
 * consumidores (feed, detalle, videos). El contrato real de la fila lo fija
 * `PostRow`, que sí las declara.
 * Al regenerar database.types.ts con 0038+0046, borrar el `as` y el alias.
 *
 * POR QUÉ LAS DE VIDEO VAN ACÁ Y NO EN UN SELECT APARTE (como las encuestas):
 * porque la decisión que habilitan —¿este video se mira DENTRO del anuncio o
 * abre el reel?— la toma la tarjeta, y la tarjeta se monta en las cuatro
 * superficies (feed, scroll infinito, detalle, reel). Un select que las pidiera
 * sólo en una deja a las otras tres decidiendo con datos que no tienen; es
 * exactamente el agujero que este bloque vino a cerrar. Son cinco columnas
 * escalares: el costo es nulo al lado de la clase de bug que evitan.
 */
export const POST_COLUMNS =
  "id, body, kind, media, status, like_count, comment_count, view_count, created_at, author_id, entity_listing_id, video_type, duration_seconds, is_paid_ad, eligible_for_short_feed, video_category, pinned_at, hidden_at, comments_locked_at, media_filters, mux_playback_id, mux_status" as ParsablePostColumns;

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
 *
 * LANZA SI LA LECTURA FALLA, y es deliberado que acá sea al revés que en el
 * resto del módulo (encuestas, música y guardados degradan en silencio porque
 * son adornos de la tarjeta). Esto NO es un adorno: es el filtro que saca del
 * feed, del reel y del hilo a la persona que el viewer bloqueó, y lo consumen
 * las tres superficies. Devolver un set vacío ante un error convierte «no pude
 * leer tus bloqueos» en «no bloqueaste a nadie»: quien bloqueó a su acosador lo
 * vuelve a ver por un hipo de la base, sin una sola línea de log. Fail-closed —
 * el error sube y lo agarra el error boundary (src/app/error.tsx) o el
 * "reintentar" del scroll infinito (feed-list.tsx): una pantalla honesta antes
 * que un feed que miente.
 *
 * TOPE de BLOCKED_PROFILES_CAP: los ids se concatenan en un
 * `author_id.not.in.(…)` que viaja por la URL (ver «el presupuesto de 8 KB»).
 * Se ordena por `created_at desc` para que, pasado el tope, sobrevivan los
 * bloqueos MÁS RECIENTES — que son los que la persona acaba de decidir. Un
 * viewer con más de 200 bloqueos vuelve a ver a los más viejos: es una pérdida
 * real y por eso el arreglo de fondo (el filtro dentro de la base) no es
 * opcional.
 */
export async function fetchBlockedIds(
  supabase: Supabase,
  viewerId: string | null,
): Promise<Set<string>> {
  if (!viewerId) return new Set();
  const result = await supabase
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocker_id", viewerId)
    .order("created_at", { ascending: false })
    .limit(BLOCKED_PROFILES_CAP);
  if (result.error) {
    console.error("[feed] no se pudieron leer los bloqueos del viewer", {
      code: result.error.code,
    });
    throw new Error("No se pudieron leer los bloqueos del viewer");
  }
  return new Set(result.data.map((row) => row.blocked_id));
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

// ---------------------------------------------------------------------------
// Música asociada a una publicación (contrato 0090)
// ---------------------------------------------------------------------------

/** Fila cruda de `post_music` con su pista embebida, tal como la sirve PostgREST. */
interface PostMusicRow {
  post_id: string;
  start_seconds: number;
  music_tracks: {
    id: string;
    title: string;
    artist: string;
    duration_seconds: number;
    storage_path: string;
    license_kind: string;
    attribution_required: boolean;
    attribution_text: string | null;
    category: string;
  } | null;
}

function musicLicenseKindOf(raw: string): MusicLicenseKind {
  return (MUSIC_LICENSE_KINDS as readonly string[]).includes(raw)
    ? (raw as MusicLicenseKind)
    : "licensed"; // valor desconocido → el más restrictivo, nunca un pass libre.
}

function musicCategoryOf(raw: string): MusicCategory {
  return (MUSIC_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as MusicCategory)
    : "general";
}

/**
 * Música de una tanda de posts, en UNA query con la pista ya embebida (join a
 * `music_tracks`). Mismo patrón que `fetchPostPolls`/`fetchPostTags`: query
 * APARTE de `POST_COLUMNS` —`post_music` es tabla propia, sólo existe la fila
 * cuando hay música— y schema abierto porque la 0090 todavía no está en
 * `database.types.ts` (al regenerarlo, sacar el cast).
 *
 * NUNCA LANZA. Sin la migración aplicada, o si la query falla por lo que sea,
 * ninguna publicación pinta su badge de música y el resto del feed sigue
 * exactamente igual — un feed roto es mucho peor que una publicación sin
 * pista.
 */
export async function fetchPostMusic(
  supabase: Supabase,
  postIds: string[],
): Promise<Map<string, PostMusicView>> {
  const byPostId = new Map<string, PostMusicView>();
  const ids = [...new Set(postIds.filter(Boolean))];
  if (ids.length === 0) return byPostId;

  const open = supabase as unknown as SupabaseClient;
  const { data, error } = await open
    .from("post_music")
    .select(
      "post_id, start_seconds, music_tracks(id, title, artist, duration_seconds, storage_path, license_kind, attribution_required, attribution_text, category)",
    )
    .in("post_id", ids);

  if (error) {
    console.warn("[feed] query de música falló", { code: error.code });
    return byPostId;
  }

  for (const row of (data ?? []) as unknown as PostMusicRow[]) {
    const track = row.music_tracks;
    // FK `on delete restrict`: en teoría no debería faltar. No lo asumimos —
    // una fila sin pista embebida no se pinta, no rompe la lectura.
    if (!track) continue;
    byPostId.set(row.post_id, {
      startSeconds: row.start_seconds,
      track: {
        id: track.id,
        title: track.title,
        artist: track.artist,
        durationSeconds: track.duration_seconds,
        previewUrl: musicTrackUrl(track.storage_path),
        licenseKind: musicLicenseKindOf(track.license_kind),
        attributionRequired: track.attribution_required,
        attributionText: track.attribution_text,
        category: musicCategoryOf(track.category),
      },
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
 *
 * ── POR QUÉ FILTRA `target_kind = 'listing'` Y NO TAMBIÉN `'profile'` ───────
 * `follows` es polimórfica desde la 0023 y acepta las dos, así que a primera
 * vista esto parece la mitad de la lectura: seguir a una PERSONA no cambiaría
 * nada en el feed. Se revisó, y no es un olvido — es que hoy no hay nada que
 * cambiar. El alcance de un post depende de `entity_listing_id`:
 *
 *   · con ficha (`entity_listing_id` no nulo) → sólo seguidores de ESA FICHA;
 *     el seguimiento es a la ficha, que es de kind 'listing'.
 *   · sin ficha (post personal) → ya llega a TODA la comunidad, se siga o no a
 *     su autor. No hay nada que un follow de perfil pueda desbloquear.
 *
 * O sea que seguir un perfil no queda sin efecto (alimenta el contador de
 * seguidores, el ranking de creadores y la notificación de "te empezó a
 * seguir"): simplemente no tiene por dónde tocar el reparto del feed, porque lo
 * que repartiría ya es público. Hacerlo contar acá exigiría antes decidir en la
 * spec que un post personal DEJE de ser universal, que es un cambio de producto
 * y no un arreglo — y uno que hoy vaciaría el feed de todo el mundo.
 *
 * TOPE de FOLLOWED_LISTINGS_CAP: estos ids se inlinean en
 * `entity_listing_id.in.(…)` y viajan por la URL (ver «el presupuesto de 8 KB»).
 * `created_at desc` para que, pasado el tope, sobrevivan los seguimientos MÁS
 * RECIENTES: quien sigue 250 entidades ve las 200 que eligió último, no una
 * muestra arbitraria del planificador.
 */
export async function fetchFollowedListingIds(
  supabase: Supabase,
  viewerId: string | null,
): Promise<string[]> {
  if (!viewerId) return [];
  const { data, error } = await supabase
    .from("follows")
    .select("target_id")
    .eq("follower_id", viewerId)
    .eq("target_kind", "listing")
    .order("created_at", { ascending: false })
    .limit(FOLLOWED_LISTINGS_CAP);
  // A diferencia de los bloqueos, esto NO es fail-closed: seguir es alcance, no
  // seguridad. Sin la lista, el feed queda con lo personal + lo promocionado —
  // menos contenido, nada indebido. Pero se LOGUEA: un feed misteriosamente
  // pobre tiene que dejar rastro.
  if (error) {
    console.warn("[feed] no se pudieron leer los seguidos del viewer", {
      code: error.code,
    });
    return [];
  }
  return (data ?? []).map((row) => row.target_id);
}

export interface ActivePromotions {
  /** Posts con campaña vigente: alimentan la visibilidad y el chip "Publicidad". */
  postIds: Set<string>;
  /** postId → teléfono del botón de WhatsApp que ofrece ESA campaña. */
  whatsappByPostId: Map<string, string>;
  /**
   * postId → zonas que compró esa campaña (`null` = toda la comunidad).
   *
   * Es el `audience` de la 0023, que hasta la 0115 nadie leía. Lo usa el feed
   * con "Tu zona" activa para no achicarle el alcance a una campaña que pagó
   * llegar a todos, ni ampliárselo a una que eligió barrios.
   */
  zonasByPostId: Map<string, ZonasDeCampana>;
}

/**
 * Promociones ACTIVAS vigentes del tenant. Una campaña paga lleva el post al
 * feed de todos los que alcanza — acá resolvemos el set para (a) inyectarlo en
 * la visibilidad, (b) marcar el chip "Publicidad", (c) saber si la campaña
 * ofrece un WhatsApp de contacto (cta_whatsapp, 0038) y (d) hasta qué zonas
 * compró llegar.
 *
 * `audience` (scope all | zones) dejó de ser "para el futuro" con la 0115: es
 * lo que decide si una campaña sobrevive al filtro de "Tu zona". Ver
 * `@/lib/zona/campanas`.
 *
 * cta_whatsapp llega con la 0038 y todavía no está en database.types.ts →
 * cliente de schema abierto. Si la columna aún no existe (entorno sin migrar),
 * se reintenta con la forma vieja: perder el botón de WhatsApp es aceptable,
 * perder los posts promocionados del feed no.
 *
 * TOPE de ACTIVE_PROMOTIONS_CAP: esta es la lista COMPARTIDA (es del tenant, no
 * del viewer), la que hace que el 414 le pegue a todo el mundo al mismo tiempo
 * — ver «el presupuesto de 8 KB de la URL» arriba. `ends_at desc` porque, si
 * alguna vez hubiera más de 150 campañas vigentes, las que tienen que
 * sobrevivir al corte son las que más días de campaña les quedan por delante, y
 * no las que están por vencer; el índice `post_promotions_tenant_active_idx
 * (tenant_id, status, ends_at desc)` ya sirve ese orden sin ordenar nada en
 * memoria.
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
      .gt("ends_at", new Date().toISOString())
      .order("ends_at", { ascending: false })
      .limit(ACTIVE_PROMOTIONS_CAP);

  let { data, error } = await activeQuery("post_id, cta_whatsapp, audience");
  if (error) {
    console.warn("[feed] campañas activas sin cta_whatsapp", { code: error.code });
    ({ data, error } = await activeQuery("post_id, audience"));
  }

  // El cliente abierto no puede derivar la forma de la fila (el select es una
  // variable): la fijamos nosotros, que es justamente lo que pedimos arriba.
  const rows = (data ?? []) as unknown as Array<{
    post_id: string;
    cta_whatsapp?: string | null;
    audience?: unknown;
  }>;
  const postIds = new Set<string>();
  const whatsappByPostId = new Map<string, string>();
  const zonasByPostId = new Map<string, ZonasDeCampana>();
  for (const row of rows) {
    postIds.add(row.post_id);
    const phone = row.cta_whatsapp?.trim();
    if (phone) whatsappByPostId.set(row.post_id, phone);
    zonasByPostId.set(row.post_id, zonasDeCampana(row.audience));
  }
  return { postIds, whatsappByPostId, zonasByPostId };
}

/**
 * Las promociones vigentes de UNA LISTA ACOTADA de posts — los de la página que
 * se está por pintar, nunca más de `PAGE_SIZE`.
 *
 * Es la contracara de `fetchActivePromotions`, y la diferencia importa: aquella
 * trae las campañas del TENANT porque las necesita para DECIDIR QUÉ ENTRA al
 * feed (`feedPostVisibilityFilter`), y por eso carga con el tope de 150 y con el
 * 414 que le pega a todo el mundo a la vez. Esta sólo responde "de estos ocho
 * posts, ¿cuáles van con chip Publicidad y cuál ofrece WhatsApp?" — una
 * pregunta que se hace DESPUÉS de tener la página, sobre una lista que por
 * construcción no crece.
 *
 * Cuando el feed pasa por el RPC (`feed-rpc.ts`), la decisión de alcance ya la
 * tomó la base y esta es la ÚNICA lectura de campañas que queda: ocho uuids de
 * querystring en vez de ciento cincuenta.
 */
export async function fetchPromotionsForPosts(
  supabase: Supabase,
  tenantId: string,
  postIds: string[],
): Promise<ActivePromotions> {
  const ids = [...new Set(postIds.filter(Boolean))];
  if (ids.length === 0) {
    return { postIds: new Set(), whatsappByPostId: new Map(), zonasByPostId: new Map() };
  }

  const open = supabase as unknown as SupabaseClient;
  const scopedQuery = (columns: string) =>
    open
      .from("post_promotions")
      .select(columns)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .in("post_id", ids);

  // Mismo reintento que `fetchActivePromotions`: un entorno sin `cta_whatsapp`
  // (0038) pierde el botón, nunca el chip.
  let { data, error } = await scopedQuery("post_id, cta_whatsapp, audience");
  if (error) {
    console.warn("[feed] campañas de la página sin cta_whatsapp", { code: error.code });
    ({ data, error } = await scopedQuery("post_id, audience"));
  }
  if (error) {
    console.warn("[feed] no se pudieron leer las campañas de la página", {
      code: error.code,
    });
    return { postIds: new Set(), whatsappByPostId: new Map(), zonasByPostId: new Map() };
  }

  const rows = (data ?? []) as unknown as Array<{
    post_id: string;
    cta_whatsapp?: string | null;
    audience?: unknown;
  }>;
  const promotedIds = new Set<string>();
  const whatsappByPostId = new Map<string, string>();
  const zonasByPostId = new Map<string, ZonasDeCampana>();
  for (const row of rows) {
    promotedIds.add(row.post_id);
    const phone = row.cta_whatsapp?.trim();
    if (phone) whatsappByPostId.set(row.post_id, phone);
    zonasByPostId.set(row.post_id, zonasDeCampana(row.audience));
  }
  return { postIds: promotedIds, whatsappByPostId, zonasByPostId };
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

  // `checked_at` es `timestamptz`: el instante en que se consultó el registro
  // oficial. Con la zona fija, la banda de verificación fechaba un día antes a
  // quien mira desde la costa oeste.
  const formatDate = await getViewerFormatDate();
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
          // Ya venía en el AuthorView del batch (fetchAuthorViews): esto no
          // agrega ni una consulta, sólo deja de tirar el dato.
          profileId: author.profileId,
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
    /** Etiquetados de ESTE post (fetchPostTags, en batch). Ausente → ninguno. */
    taggedPeople?: TaggedProfile[];
    /** Música de ESTE post (fetchPostMusic, en batch). Ausente → sin música. */
    music?: PostMusicView | null;
  },
): PostCardModel {
  // Bucket post-media (0025): fotos y videos conviven en el array `media`;
  // el kind se infiere por extensión (mediaKindOf). photoUrl queda como la
  // primera FOTO para los consumidores viejos que renderizan <img>.
  const filterCssByPath = mediaFilterCssByPath(row.media_filters);
  const media: PostMediaView[] = row.media
    .filter((path) => path && path.trim().length > 0)
    .map((path) => ({
      kind: mediaKindOf(path),
      url: postMediaUrl(path),
      // Se busca por la RUTA guardada, no por posición: quitar una foto de una
      // publicación ya publicada (0097) no puede correrle el filtro al video.
      filterCss: filterCssByPath.get(path),
    }));

  /**
   * ---- LA DIAPOSITIVA DEL VIDEO DE MUX -----------------------------------
   *
   * Un video subido por Mux no deja ruta en `posts.media`: el archivo nunca pasó
   * por el bucket. Si esta función se quedara sólo con las rutas, una
   * publicación con video de Mux llegaría a la tarjeta SIN NINGÚN MEDIO — un
   * post con pie y un hueco donde debería estar el video.
   *
   * Así que la diapositiva se arma acá, desde las dos columnas del post. Es el
   * único lugar del repo donde eso pasa, y tiene que serlo: el carrusel, la
   * fila de acciones, el visor y el reel leen todos de este mismo array.
   *
   * `url` es la MINIATURA y no una cadena vacía (ver `PostMediaView`): quien
   * todavía no sepa de Mux pinta el primer cuadro, no un medio roto.
   *
   * SÓLO si `mux_status` es un valor conocido. Una fila con basura en esa
   * columna no genera diapositiva: preferimos una publicación sin video —que es
   * lo que hoy se ve— antes que una tarjeta con un reproductor que no puede
   * reproducir nada.
   *
   * Y sólo si NO hay ya un video en `media`: si alguna vez conviven los dos
   * caminos en una misma fila, manda el archivo que existe de verdad.
   */
  const muxStatus = parseMuxStatus(row.mux_status);
  const muxPlaybackId = row.mux_playback_id ?? null;
  if (muxStatus !== null && !media.some((item) => item.kind === "video")) {
    media.push({
      kind: "video",
      url: muxPlaybackId ? muxThumbnailUrl(muxPlaybackId) : "",
      muxPlaybackId,
      muxStatus,
      /**
       * El filtro (0104) de un video de Mux se guarda bajo `MUX_FILTER_KEY` y
       * no bajo una ruta, porque no hay ruta que usar de clave — el archivo
       * nunca pasó por el bucket. Es el otro extremo de lo que escribe
       * `createPostAction`; sin esta línea el filtro se guardaba y no lo
       * encontraba nadie.
       */
      filterCss: filterCssByPath.get(MUX_FILTER_KEY),
    });
  }

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
    // Vacío y no `undefined`: el modelo promete un array siempre (ver
    // PostCardModel). Una superficie que todavía no consulta `post_tags`
    // muestra un post sin etiquetas, que es la verdad hasta que lo pida.
    taggedPeople: extras?.taggedPeople ?? [],
    // `null` y no `undefined`: mismo criterio que taggedPeople. Una superficie
    // que todavía no consulta `post_music` muestra un post sin música, que es
    // la verdad hasta que lo pida.
    music: extras?.music ?? null,
    // Insumos del menú ⋯ (0097). Se mapean SIEMPRE y por el MISMO motivo que
    // las columnas de video: el menú se monta en el feed y en el detalle, y una
    // superficie que no los tuviera ofrecería "Fijar" sobre algo ya fijado.
    postMenu: {
      authorId: row.author_id,
      status: row.status,
      // Las rutas CRUDAS, no las URLs públicas de `media`: la hoja de edición
      // quita fotos nombrándolas por su ruta en el bucket.
      mediaPaths: row.media,
      pinnedAt: row.pinned_at ?? null,
      hiddenAt: row.hidden_at ?? null,
      commentsLockedAt: row.comments_locked_at ?? null,
    },
    // Columnas de video (0046). Se mapean SIEMPRE, en todas las superficies:
    // son las que dejan que la tarjeta sepa que un video es publicitario aunque
    // su campaña ya no esté vigente. `?? false` / `?? true` espejan los defaults
    // de la migración (is_paid_ad default false, eligible_for_short_feed default
    // true — que es un VETO, no una afirmación).
    videoType: row.video_type,
    durationSeconds: row.duration_seconds,
    isPaidAd: row.is_paid_ad ?? false,
    eligibleForShortFeed: row.eligible_for_short_feed ?? true,
    videoCategory: row.video_category,
    ctaWhatsapp: extras?.ctaWhatsapp ?? null,
  };
}
