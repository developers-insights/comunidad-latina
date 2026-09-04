import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import {
  POST_COLUMNS,
  VISIBLE_POSTS_FILTER,
  fetchActivePromotedPostIds,
  fetchAuthorViews,
  fetchBlockedIds,
  fetchEntityViews,
  fetchPostMusic,
  fetchViewerLikes,
  toPostCardModel,
  type PostRow,
} from "@/app/(app)/feed/queries";
import type { PostCardModel } from "@/components/feed";
import { encodeCursor } from "@/components/listings";
import {
  SHORT_VIDEO_MAX_SECONDS,
  isLongVideo,
  type VideoCategory,
} from "@/lib/media/video-policy";
import { parseMuxStatus } from "@/lib/media/mux-video";
import { fetchViewerSaves } from "../queries";
import { hasVideoMedia } from "../helpers";

/**
 * Lecturas de VIDEOS LARGOS (`/videos/largos`). Server-only y siempre con el
 * cliente del usuario: la RLS aplica en cada consulta.
 *
 * ---- POR QUÉ ESTA SECCIÓN EXISTE ------------------------------------------
 * Pedido del cliente del 2026-09-03 (19:40–23:44 y 1:09–1:11), dicho dos veces
 * en la misma call: "una sección de los videos largos donde la gente vaya a ver
 * su video de 5 minutos". En el feed y en Videos Cortos se ven 59 segundos y
 * aparece "Ver video completo"; el completo se mira acá.
 *
 * ---- QUÉ ENTRA, Y POR QUÉ NO ES EL REVERSO DEL REEL ------------------------
 * Sólo lo que `isLongVideo` llama largo: `advertising_video` (el único tipo que
 * la base deja pasar de 90 s) o una duración declarada mayor al tope de los
 * cortos. NO entra "todo lo que el reel descarta": un corto de 90 s que su
 * autor sacó del scroll (`eligible_for_short_feed = false`) sigue siendo corto y
 * no tiene nada que hacer en una sección que promete videos de cinco minutos.
 *
 * ---- QUÉ VISIBILIDAD SE APLICA --------------------------------------------
 * Publicado, del tenant, no oculto por su autor (0097) y sin gente bloqueada —
 * lo mismo que el resto. Lo que NO se aplica es el grafo de seguidos del feed
 * ("para ti"): esta pantalla es un DESTINO al que se entra a buscar videos
 * largos, y filtrar por a quién seguís la dejaría vacía justo para quien recién
 * llega. La RLS sigue siendo la que decide qué filas se pueden leer.
 *
 * ---- CÓMO SE PAGINA -------------------------------------------------------
 * El mismo keyset por (created_at, id) que `fetchVideoReelsPage`, con barridas
 * y filtro en memoria: `posts.media` es text[] sin columna de tipo, así que
 * "trae un archivo de video" no se puede preguntar en PostgREST y se resuelve
 * acá. El cursor apunta a la última fila ESCANEADA, así la próxima tanda retoma
 * donde quedó sin releer ni saltear.
 */

type Supabase = SupabaseClient<Database>;

const SCAN_CHUNK = 40;
const MAX_SCANS = 4;
const DEFAULT_PAGE_SIZE = 10;

/**
 * EL PREDICADO DE "LARGO", DEL LADO DE LA BASE.
 *
 * Es la mitad de `isLongVideo` que PostgREST puede evaluar, y tiene que decir
 * exactamente lo mismo que la función: el tipo publicitario, o una duración
 * declarada por encima del tope de los cortos. El número no se escribe a mano —
 * sale de `SHORT_VIDEO_MAX_SECONDS`, para que subirlo (o bajarlo) en
 * `video-policy` mueva la consulta y el filtro en memoria a la vez.
 *
 * La otra mitad —"¿hay de verdad un archivo reproducible?"— se sigue resolviendo
 * en memoria, por lo mismo que en el reel: `media` es text[] sin tipo.
 */
export const LONG_VIDEO_FILTER = `video_type.eq.advertising_video,duration_seconds.gt.${SHORT_VIDEO_MAX_SECONDS}`;

export interface LongVideosCursor {
  createdAt: string;
  id: string;
}

export interface LongVideosPage {
  items: PostCardModel[];
  /** Cursor opaco (mismo formato que el feed) o null si no hay más. */
  nextCursor: string | null;
}

interface FetchArgs {
  supabase: Supabase;
  tenantId: string;
  viewerId: string | null;
  /** Tema del menú. null = todos los temas. */
  category?: VideoCategory | null;
  cursor: LongVideosCursor | null;
  pageSize?: number;
  /** Publicación que NO va en la lista (el "Más videos largos" del reproductor). */
  excludeId?: string | null;
}

/**
 * ¿Esta fila se puede mirar en la sección de largos? Una sola pregunta para la
 * lista, para el reproductor y para el "Más videos largos" de abajo: la consulta
 * ya filtró en la base, pero un id escrito a mano en la URL apunta a CUALQUIER
 * post publicado, y sin este chequeo un corto de 20 segundos abriría la sección
 * de los cinco minutos.
 */
export function canPlayAsLongVideo(row: PostRow): boolean {
  if (!isLongVideo({ videoType: row.video_type, durationSeconds: row.duration_seconds })) {
    return false;
  }
  if (row.status !== "published") return false;
  if (row.hidden_at) return false;
  /**
   * "TIENE VIDEO" SON DOS COSAS desde Mux (0116): un archivo en el bucket, o un
   * video de Mux ya listo. Uno todavía en proceso no se muestra acá —a
   * diferencia de la tarjeta del feed, donde el autor necesita ver que su video
   * salió—: esta pantalla ES el reproductor, y abrirla para decir "esperá un
   * rato" es una pantalla que no cumple lo que prometió el botón.
   */
  return hasVideoMedia(row.media) || parseMuxStatus(row.mux_status) === "ready";
}

export async function fetchLongVideosPage({
  supabase,
  tenantId,
  viewerId,
  category = null,
  cursor,
  pageSize = DEFAULT_PAGE_SIZE,
  excludeId = null,
}: FetchArgs): Promise<LongVideosPage> {
  const [blockedIds, promotedPostIds] = await Promise.all([
    fetchBlockedIds(supabase, viewerId),
    fetchActivePromotedPostIds(supabase, tenantId),
  ]);

  const buildQuery = (keyset: LongVideosCursor | null) => {
    let query = supabase
      .from("posts")
      .select(POST_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(SCAN_CHUNK);

    // LO QUE SOSTIENE LA SECCIÓN: sólo videos largos. Un corto no entra ni por
    // casualidad — ni acá ni en el "Más videos largos" del reproductor, porque
    // el de abajo sale de esta misma consulta.
    query = query.or(LONG_VIDEO_FILTER);

    // Tema del menú. "Otros" incluye además los videos SIN categoría, igual que
    // en Videos Cortos: la columna es nullable, y un video sin tema declarado ES
    // "todo lo demás" — mandarlo a ninguna parte lo volvería inalcanzable.
    if (category === "otros") {
      query = query.or("video_category.is.null,video_category.eq.otros");
    } else if (category) {
      query = query.eq("video_category", category);
    }

    // Sólo lo que HOY se puede reproducir (ver el docblock de `canPlayAsLongVideo`).
    query = query.or("mux_status.is.null,mux_status.eq.ready");

    // Fuera lo que su autor ocultó (0097).
    query = query.or(VISIBLE_POSTS_FILTER);

    if (blockedIds.size > 0) {
      query = query.or(
        `author_id.is.null,author_id.not.in.(${[...blockedIds].join(",")})`,
      );
    }

    if (keyset) {
      query = query.or(
        `created_at.lt."${keyset.createdAt}",and(created_at.eq."${keyset.createdAt}",id.lt."${keyset.id}")`,
      );
    }

    return query;
  };

  const videoRows: PostRow[] = [];
  const seenIds = new Set<string>();

  let scanCursor = cursor;
  let exhausted = false;
  let lastScanned: LongVideosCursor | null = null;

  for (let scan = 0; scan < MAX_SCANS && videoRows.length <= pageSize; scan += 1) {
    const { data, error } = await buildQuery(scanCursor);
    if (error) {
      console.warn("[videos-largos] query de la lista falló", { code: error.code });
      break;
    }
    // Doble cast: `POST_COLUMNS` está anotado como `string` (ver su comentario
    // en feed/queries.ts), así que supabase-js no puede derivar la forma de la
    // fila. El contrato real lo fija `PostRow`.
    const rows = (data ?? []) as unknown as PostRow[];
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    for (const row of rows) {
      if (row.id === excludeId) continue;
      if (seenIds.has(row.id)) continue;
      if (!canPlayAsLongVideo(row)) continue;
      videoRows.push(row);
      seenIds.add(row.id);
    }
    const tail = rows[rows.length - 1];
    lastScanned = { createdAt: tail.created_at, id: tail.id };
    scanCursor = lastScanned;
    if (rows.length < SCAN_CHUNK) {
      exhausted = true;
      break;
    }
  }

  const pageRows = videoRows.slice(0, pageSize);
  const overflow = videoRows.length > pageSize;

  let nextCursor: string | null = null;
  if (overflow) {
    const lastShown = pageRows[pageRows.length - 1];
    nextCursor = encodeCursor(lastShown.created_at, lastShown.id);
  } else if (!exhausted && lastScanned) {
    nextCursor = encodeCursor(lastScanned.createdAt, lastScanned.id);
  }

  if (pageRows.length === 0) return { items: [], nextCursor };

  const items = await toLongVideoModels({
    supabase,
    viewerId,
    rows: pageRows,
    promotedPostIds,
  });

  return { items, nextCursor };
}

/**
 * UN video largo por su id. Devuelve null cuando no existe, cuando la RLS no lo
 * deja ver, o cuando NO es largo — que es lo que convierte
 * `/videos/largos/<id-de-un-corto>` en un 404 en vez de en una pantalla que
 * reproduce cualquier cosa.
 */
export async function fetchLongVideoById({
  supabase,
  tenantId,
  viewerId,
  postId,
}: {
  supabase: Supabase;
  tenantId: string;
  viewerId: string | null;
  postId: string;
}): Promise<PostCardModel | null> {
  const { data, error } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", postId)
    .maybeSingle();

  if (error) {
    console.warn("[videos-largos] query del reproductor falló", { code: error.code });
    return null;
  }
  const row = data as unknown as PostRow | null;
  if (!row || !canPlayAsLongVideo(row)) return null;

  // El bloqueo se respeta también en el link directo: si alguien bloqueó al
  // autor, su video no se abre porque le hayan pasado la URL.
  const blockedIds = await fetchBlockedIds(supabase, viewerId);
  if (row.author_id && blockedIds.has(row.author_id)) return null;

  const promotedPostIds = await fetchActivePromotedPostIds(supabase, tenantId);
  const [item] = await toLongVideoModels({
    supabase,
    viewerId,
    rows: [row],
    promotedPostIds,
  });
  return item ?? null;
}

/**
 * Filas → modelo de tarjeta, con los MISMOS helpers en batch que el feed y el
 * reel (autores, entidades, me gusta, guardados, música): una consulta por
 * tanda y no una por publicación.
 */
async function toLongVideoModels({
  supabase,
  viewerId,
  rows,
  promotedPostIds,
}: {
  supabase: Supabase;
  viewerId: string | null;
  rows: PostRow[];
  promotedPostIds: Set<string>;
}): Promise<PostCardModel[]> {
  const now = new Date();
  const pageIds = rows.map((row) => row.id);
  const entityListingIds = rows
    .map((row) => row.entity_listing_id)
    .filter((id): id is string => Boolean(id));

  const [authors, likedIds, entityById, savedIds, musicByPost] = await Promise.all([
    fetchAuthorViews(
      supabase,
      rows.map((row) => row.author_id).filter((id): id is string => Boolean(id)),
    ),
    fetchViewerLikes(supabase, viewerId, pageIds),
    fetchEntityViews(supabase, entityListingIds),
    fetchViewerSaves(supabase, viewerId, pageIds),
    fetchPostMusic(supabase, pageIds),
  ]);

  return rows.map((row) =>
    toPostCardModel(row, authors, likedIds, now, {
      entity: row.entity_listing_id
        ? (entityById.get(row.entity_listing_id) ?? null)
        : null,
      isPromoted: promotedPostIds.has(row.id),
      savedByViewer: savedIds.has(row.id),
      music: musicByPost.get(row.id) ?? null,
    }),
  );
}
