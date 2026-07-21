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
 * CÓMO SE PAGINA: posts.media es text[] sin columna de tipo, y PostgREST no
 * filtra arrays por patrón de extensión. Entonces: keyset por (created_at, id)
 * en barridas de SCAN_CHUNK posts, filtrando en memoria los que traen video,
 * hasta juntar la página o agotar el tope de barridas. El cursor que devolvemos
 * apunta a la última fila ESCANEADA (o al último video incluido), así la
 * próxima página retoma exactamente donde quedó — sin releer ni saltear.
 */

type Supabase = SupabaseClient<Database>;

const SCAN_CHUNK = 40;
const MAX_SCANS = 4;
const DEFAULT_PAGE_SIZE = 6;

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
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(SCAN_CHUNK);

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

  const videoRows: PostRow[] = [];
  const seenIds = new Set<string>();

  // El post de arranque (?start=) va PRIMERO: el reel abre en el video tocado
  // y el scroll sigue con los más viejos (mismo orden del feed). Un post
  // published es público en su detalle — acá solo respetamos el bloqueo.
  let effectiveCursor = cursor;
  if (startId && !cursor) {
    const { data: startRow } = await supabase
      .from("posts")
      .select(POST_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .eq("id", startId)
      .maybeSingle();
    const start = startRow as PostRow | null;
    if (
      start &&
      hasVideoMedia(start.media) &&
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
    const rows = (data ?? []) as PostRow[];
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    for (const row of rows) {
      if (!seenIds.has(row.id) && hasVideoMedia(row.media)) {
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

  const [authors, likedIds, entityById] = await Promise.all([
    fetchAuthorViews(
      supabase,
      pageRows.map((row) => row.author_id).filter((id): id is string => Boolean(id)),
    ),
    fetchViewerLikes(
      supabase,
      viewerId,
      pageRows.map((row) => row.id),
    ),
    fetchEntityViews(supabase, entityListingIds),
  ]);

  const items = pageRows.map((row) =>
    toPostCardModel(row, authors, likedIds, now, {
      entity: row.entity_listing_id
        ? (entityById.get(row.entity_listing_id) ?? null)
        : null,
      isPromoted: promotedPostIds.has(row.id),
    }),
  );

  return { items, nextCursor };
}
