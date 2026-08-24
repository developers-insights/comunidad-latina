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
  fetchFollowedListingIds,
  fetchViewerLikes,
  toPostCardModel,
  type PostRow,
} from "@/app/(app)/feed/queries";
import { feedPostVisibilityFilter, type PostCardModel } from "@/components/feed";
import { encodeCursor } from "@/components/listings";

/**
 * Lectura de la pestaña "Publicaciones" del módulo Profesionales (spec cliente:
 * "el newsfeed de los profesionales — contenido educativo, consejos, artículos,
 * fotos y videos, anuncios profesionales, información de su industria").
 *
 * Son los `posts` publicados COMO una ficha de `kind='professional'` (0023,
 * `entity_listing_id`). Server-only, siempre con el cliente del usuario — RLS
 * aplica en cada query.
 *
 * ── EL JOIN, NO DOS PASOS (mismo criterio que /videos/queries.ts) ───────────
 * El scope "sólo posts de una ficha profesional" se resuelve DENTRO de la base
 * con `listings!inner(id)`, no trayendo antes la lista de ids de fichas
 * profesionales del tenant: esa lista puede crecer sin techo, y meterla en un
 * `.in("entity_listing_id", …)` es exactamente el 414 que el docblock de
 * `SCOPED_POST_COLUMNS` en videos/queries.ts documenta (~19 KB contra el
 * request line de ~8 KB que aceptan Kong/nginx). Con el join no viaja NINGÚN id.
 * Sin hint de FK porque `posts` tiene una sola clave foránea a `listings`
 * (`posts_entity_listing_id_fkey`, 0023) — sin ambigüedad.
 *
 * ── MISMA VISIBILIDAD QUE EL FEED "PARA TI" (0023, feedback cliente 2026-07-19) ─
 * Un post orgánico de entidad llega SOLO a quienes siguen esa ficha; con una
 * campaña activa (`post_promotions`) llega a todos con el chip "Publicidad".
 * Ignorar esta regla acá mostraría a CUALQUIERA los posts de profesionales que
 * todavía nadie sigue — el mismo agujero que /videos ya cerró para su propio
 * scope por vertical. La regla vive UNA vez (`feedPostVisibilityFilter`) y esta
 * pestaña la aplica igual que el feed y que /videos.
 */

type Supabase = SupabaseClient<Database>;

/**
 * Mismas columnas del post + el join INNER a la ficha profesional que lo
 * publica. `as typeof POST_COLUMNS` es el mismo truco que en feed/queries.ts:
 * el VALOR pide el embed a PostgREST: el TIPO se queda en las columnas que
 * `PostRow` ya declara.
 */
const SCOPED_POST_COLUMNS = `${POST_COLUMNS}, listings!inner(id)` as typeof POST_COLUMNS;

export const PROFESSIONAL_POSTS_PAGE_SIZE = 8;

export interface ProfessionalPostsCursor {
  createdAt: string;
  id: string;
}

export interface ProfessionalPostsPage {
  items: PostCardModel[];
  /** Cursor keyset ya codificado de la próxima página, o null si no hay más. */
  nextCursor: string | null;
}

export async function fetchProfessionalPostsPage(
  supabase: Supabase,
  args: {
    tenantId: string;
    viewerId: string | null;
    cursor: ProfessionalPostsCursor | null;
    pageSize?: number;
  },
): Promise<ProfessionalPostsPage> {
  const pageSize = args.pageSize ?? PROFESSIONAL_POSTS_PAGE_SIZE;

  // Contexto del viewer (idéntico al feed y a /videos): bloqueados, seguidos,
  // promociones vigentes. Las tres son independientes entre sí.
  const [blockedIds, followedListingIds, promotedPostIds] = await Promise.all([
    fetchBlockedIds(supabase, args.viewerId),
    fetchFollowedListingIds(supabase, args.viewerId),
    fetchActivePromotedPostIds(supabase, args.tenantId),
  ]);

  let query = supabase
    .from("posts")
    .select(SCOPED_POST_COLUMNS)
    .eq("tenant_id", args.tenantId)
    .eq("status", "published")
    // Scope de módulo: sólo posts de una ficha PUBLICADA de kind='professional'.
    // Filtro sobre el recurso embebido — con `!inner` en el select, filtrar la
    // ficha filtra el post (mismo patrón que /videos). El tenant de la ficha no
    // hace falta repetirlo: ya es el mismo por policy (0023).
    .eq("listings.kind", "professional")
    .eq("listings.status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);

  // Alcance "para vos" (los ids vienen de la DB, no del usuario). PostgREST
  // AND-ea cada `.or()` de nivel superior con los demás filtros.
  query = query.or(feedPostVisibilityFilter(followedListingIds, [...promotedPostIds]));

  // Fuera lo que su autor ocultó del feed (0097) — misma regla que el feed y
  // /videos: esta pestaña también es una superficie de descubrimiento.
  query = query.or(VISIBLE_POSTS_FILTER);

  if (blockedIds.size > 0) {
    query = query.or(`author_id.is.null,author_id.not.in.(${[...blockedIds].join(",")})`);
  }

  if (args.cursor) {
    query = query.or(
      `created_at.lt."${args.cursor.createdAt}",and(created_at.eq."${args.cursor.createdAt}",id.lt."${args.cursor.id}")`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[profesionales] query de publicaciones falló", { code: error.code });
    return { items: [], nextCursor: null };
  }

  // Mismo doble cast que feed/queries.ts y videos/queries.ts: `SCOPED_POST_COLUMNS`
  // está anotado como el tipo string de POST_COLUMNS, así que supabase-js no
  // puede derivar la forma real de la fila. El contrato lo fija `PostRow`.
  const rows = (data ?? []) as unknown as PostRow[];
  const pageRows = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;

  if (pageRows.length === 0) {
    return { items: [], nextCursor: null };
  }

  const now = new Date();
  const entityListingIds = pageRows
    .map((row) => row.entity_listing_id)
    .filter((id): id is string => Boolean(id));
  const pageIds = pageRows.map((row) => row.id);

  const [authors, likedIds, entityById] = await Promise.all([
    fetchAuthorViews(
      supabase,
      pageRows.map((row) => row.author_id).filter((id): id is string => Boolean(id)),
    ),
    fetchViewerLikes(supabase, args.viewerId, pageIds),
    fetchEntityViews(supabase, entityListingIds),
  ]);

  const items = pageRows.map((row) =>
    toPostCardModel(row, authors, likedIds, now, {
      entity: row.entity_listing_id ? (entityById.get(row.entity_listing_id) ?? null) : null,
      isPromoted: promotedPostIds.has(row.id),
    }),
  );

  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

  return { items, nextCursor };
}
