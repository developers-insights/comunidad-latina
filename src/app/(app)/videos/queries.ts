import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import {
  POST_COLUMNS,
  fetchActivePromotedPostIds,
  fetchAuthorViews,
  fetchBlockedIds,
  fetchEntityViews,
  fetchFollowedListingIds,
  fetchViewerLikes,
  toPostCardModel,
  type PostRow,
} from "@/app/(app)/feed/queries";
import { feedPostVisibilityFilter, type PostCardModel } from "@/components/feed";
import { encodeCursor } from "@/components/listings";
import { isEligibleForShortFeed, type VideoCategory } from "@/lib/media/video-policy";
import { hasVideoMedia, scopeListingKind, type VideosScope } from "./helpers";

/**
 * Lecturas del módulo VIDEOS (reels). Server-only, siempre con el cliente del
 * usuario — RLS aplica en cada query.
 *
 * MISMA visibilidad que el feed "Para ti" (feedback cliente 2026-07-19):
 * personal (entity null) + entidades que el viewer sigue + posts con campaña
 * activa, y nunca contenido de gente bloqueada. El scope por módulo AGREGA un
 * filtro por vertical del listing (posts de entidad de ese kind) encima de esa
 * misma regla — no la reemplaza.
 *
 * QUÉ ENTRA AL REEL (contrato 0046 + §4 del feedback consolidado): SÓLO
 * `video_type = 'short_video'` con `eligible_for_short_feed`. El video
 * publicitario —hasta 10 minutos, atado a una campaña— NUNCA aparece acá ni
 * como "el siguiente" al deslizar: se reproduce dentro de su anuncio. El
 * predicado es el mismo del índice parcial `posts_short_feed_idx`, así que
 * además de correcto es barato.
 *
 * CÓMO SE PAGINA: posts.media es text[] sin columna de tipo, y PostgREST no
 * filtra arrays por patrón de extensión. Entonces: keyset por (created_at, id)
 * en barridas de SCAN_CHUNK posts, filtrando en memoria los que traen video,
 * hasta juntar la página o agotar el tope de barridas. El cursor que devolvemos
 * apunta a la última fila ESCANEADA (o al último video incluido), así la
 * próxima página retoma exactamente donde quedó — sin releer ni saltear.
 */

type Supabase = SupabaseClient<Database>;

/**
 * Las columnas de video de la 0046 ya viajan en POST_COLUMNS desde el
 * 2026-07-30: el reel no era la única superficie que necesitaba distinguir un
 * corto de un video publicitario —la tarjeta del feed también, para no mandar
 * al scroll a quien tocó un anuncio— así que se subieron a la fila común en vez
 * de vivir sólo acá. `VideoPostRow` queda como alias para no reescribir el
 * archivo entero; el contrato es el mismo `PostRow`.
 */
type VideoPostRow = PostRow;

const SCAN_CHUNK = 40;
const MAX_SCANS = 4;
const DEFAULT_PAGE_SIZE = 6;

// ---------------------------------------------------------------------------
// Engagement del reel: guardados (tabla saves, 0038)
// ---------------------------------------------------------------------------
// Las VISTAS no necesitan query propia: `view_count` ya viaja en POST_COLUMNS y
// toPostCardModel la mapea a `viewCount` (0 hasta que corra el backfill).

/**
 * Posts que el viewer tiene GUARDADOS, en batch — espeja a `fetchViewerLikes`
 * del feed (mismo shape subject_kind/subject_id). Vacío sin sesión.
 */
export async function fetchViewerSaves(
  supabase: Supabase,
  viewerId: string | null,
  postIds: string[],
): Promise<Set<string>> {
  if (!viewerId || postIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("saves")
    .select("subject_id")
    .eq("subject_kind", "post")
    .eq("profile_id", viewerId)
    .in("subject_id", postIds);
  if (error) return new Set();
  return new Set((data ?? []).map((row) => row.subject_id));
}

export interface ReelsCursor {
  createdAt: string;
  id: string;
}

export interface VideoReelsPage {
  items: PostCardModel[];
  /** Cursor opaco (mismo formato que el feed) o null si no hay más. */
  nextCursor: string | null;
}

interface FetchArgs {
  supabase: Supabase;
  tenantId: string;
  viewerId: string | null;
  scope: VideosScope;
  /** Tema elegido en el menú de entrada. null = "Todos" (sin filtro de tema). */
  category?: VideoCategory | null;
  cursor: ReelsCursor | null;
  /** Post que abre el reel (?start=): va primero y el resto pagina detrás. */
  startId?: string | null;
  pageSize?: number;
}

export async function fetchVideoReelsPage({
  supabase,
  tenantId,
  viewerId,
  scope,
  category = null,
  cursor,
  startId = null,
  pageSize = DEFAULT_PAGE_SIZE,
}: FetchArgs): Promise<VideoReelsPage> {
  // Contexto del viewer (idéntico al feed): bloqueados, seguidos, promociones.
  const [blockedIds, followedListingIds, promotedPostIds] = await Promise.all([
    fetchBlockedIds(supabase, viewerId),
    fetchFollowedListingIds(supabase, viewerId),
    fetchActivePromotedPostIds(supabase, tenantId),
  ]);

  // Scope por módulo: ids de listings published de ese vertical en el tenant.
  // La comunidad es única y chica (single-community): el set entra en memoria.
  const kind = scopeListingKind(scope);
  let kindListingIds: string[] | null = null;
  if (kind) {
    const { data } = await supabase
      .from("listings")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("kind", kind)
      .eq("status", "published")
      .limit(500);
    kindListingIds = (data ?? []).map((row) => row.id);
    if (kindListingIds.length === 0) {
      return { items: [], nextCursor: null };
    }
  }

  const buildQuery = (keyset: ReelsCursor | null) => {
    let query = supabase
      .from("posts")
      .select(POST_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      // EL FILTRO QUE SOSTIENE LA SUPERFICIE (0046 §6): sólo cortos elegibles.
      // Un `advertising_video` no entra ni por casualidad — ni acá ni como "el
      // siguiente" al deslizar, porque el siguiente sale de esta misma query.
      .eq("video_type", "short_video")
      .eq("eligible_for_short_feed", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(SCAN_CHUNK);

    // Tema del menú de entrada. "Todos" no filtra (category null).
    //
    // "Otros" incluye además los videos SIN categoría. La columna es nullable y
    // los videos anteriores a la 0046 quedaron en NULL (el backfill les puso
    // `video_type`, no un tema que nadie eligió). Un video sin tema declarado ES
    // "todo lo demás": mandarlo a ninguna parte lo haría inalcanzable desde el
    // menú, que es justo lo que el menú vino a resolver. `otros` también es el
    // default al publicar, así que las dos puntas dicen lo mismo.
    if (category === "otros") {
      query = query.or("video_category.is.null,video_category.eq.otros");
    } else if (category) {
      query = query.eq("video_category", category);
    }

    if (kindListingIds) {
      // Scope de módulo: solo posts DE una entidad de ese vertical.
      query = query.in("entity_listing_id", kindListingIds);
    }

    // Alcance "para vos" (los ids vienen de la DB, no del usuario — mismo
    // patrón que el feed). PostgREST AND-ea cada .or() de nivel superior.
    query = query.or(
      feedPostVisibilityFilter(followedListingIds, [...promotedPostIds]),
    );

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

  const videoRows: VideoPostRow[] = [];
  const seenIds = new Set<string>();

  /**
   * ¿Esta fila puede vivir en el reel? Una sola pregunta, un solo módulo
   * (`video-policy`), para el `?start=` y para las barridas. La query ya filtra
   * en la base; esto es la segunda llave: un `?start=` escrito a mano apunta a
   * CUALQUIER post publicado, y sin este chequeo un video publicitario de 10
   * minutos abriría el scroll aunque la query nunca lo hubiera traído.
   */
  const canEnterReel = (row: VideoPostRow): boolean =>
    isEligibleForShortFeed({
      videoType: row.video_type,
      eligibleForShortFeed: row.eligible_for_short_feed,
      status: row.status,
      hasVideoMedia: hasVideoMedia(row.media),
      durationSeconds: row.duration_seconds,
      isPaidAd: row.is_paid_ad,
    });

  // El post de arranque (?start=) va PRIMERO: el reel abre en el video tocado
  // y el scroll sigue con los más viejos (mismo orden del feed). Un post
  // published es público en su detalle — acá respetamos el bloqueo Y la
  // elegibilidad (un video publicitario se mira en su anuncio, no acá).
  let effectiveCursor = cursor;
  if (startId && !cursor) {
    const { data: startRow } = await supabase
      .from("posts")
      .select(POST_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .eq("id", startId)
      .maybeSingle();
    const start = startRow as unknown as VideoPostRow | null;
    if (
      start &&
      canEnterReel(start) &&
      !(start.author_id && blockedIds.has(start.author_id))
    ) {
      videoRows.push(start);
      seenIds.add(start.id);
      effectiveCursor = { createdAt: start.created_at, id: start.id };
    }
  }

  // Barridas keyset + filtro en memoria (ver comentario de cabecera).
  let scanCursor = effectiveCursor;
  let exhausted = false;
  let lastScanned: ReelsCursor | null = null;

  for (let scan = 0; scan < MAX_SCANS && videoRows.length <= pageSize; scan += 1) {
    const { data, error } = await buildQuery(scanCursor);
    if (error) {
      console.warn("[videos] query de reels falló", { code: error.code });
      break;
    }
    // Doble cast: `POST_COLUMNS` está anotado como `string` (ver su comentario
    // en feed/queries.ts), así que supabase-js no puede derivar la forma de la
    // fila y devuelve `GenericStringError[]`. El contrato real lo fija PostRow.
    const rows = (data ?? []) as unknown as VideoPostRow[];
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    for (const row of rows) {
      if (!seenIds.has(row.id) && canEnterReel(row)) {
        videoRows.push(row);
        seenIds.add(row.id);
      }
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

  // Cursor de la próxima página:
  // - sobró un video → retomamos desde el ÚLTIMO video mostrado;
  // - se agotaron las barridas sin llenar → retomamos desde la última fila
  //   escaneada (puede devolver una página corta; el cliente sigue pidiendo);
  // - no quedan filas → null (fin del reel).
  let nextCursor: string | null = null;
  if (overflow) {
    const lastShown = pageRows[pageRows.length - 1];
    nextCursor = encodeCursor(lastShown.created_at, lastShown.id);
  } else if (!exhausted && lastScanned) {
    nextCursor = encodeCursor(lastScanned.createdAt, lastScanned.id);
  }

  if (pageRows.length === 0) {
    return { items: [], nextCursor };
  }

  // Batches (mismos helpers del feed): autores + likes + entidades.
  const now = new Date();
  const entityListingIds = pageRows
    .map((row) => row.entity_listing_id)
    .filter((id): id is string => Boolean(id));

  const pageIds = pageRows.map((row) => row.id);

  const [authors, likedIds, entityById, savedIds] = await Promise.all([
    fetchAuthorViews(
      supabase,
      pageRows.map((row) => row.author_id).filter((id): id is string => Boolean(id)),
    ),
    fetchViewerLikes(supabase, viewerId, pageIds),
    fetchEntityViews(supabase, entityListingIds),
    fetchViewerSaves(supabase, viewerId, pageIds),
  ]);

  // Las columnas de video viajan con el modelo (las mapea `toPostCardModel`,
  // para TODA superficie): el slide vuelve a preguntarse si el post puede estar
  // en el reel antes de pintarlo. La query ya lo filtró, pero un `video-reels`
  // que reciba items de cualquier otro lado (una acción futura, un test mal
  // armado) no puede volverse el agujero.
  const items = pageRows.map((row) =>
    toPostCardModel(row, authors, likedIds, now, {
      entity: row.entity_listing_id
        ? (entityById.get(row.entity_listing_id) ?? null)
        : null,
      isPromoted: promotedPostIds.has(row.id),
      // El botón GUARDAR del riel arranca en su estado real (no siempre vacío).
      savedByViewer: savedIds.has(row.id),
    }),
  );

  return { items, nextCursor };
}
