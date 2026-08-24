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
 * =============================================================================
 * LA PESTAÑA "PUBLICACIONES" DE NEGOCIOS — el newsfeed comercial
 * =============================================================================
 *
 * Spec del cliente: «fotos, videos, textos, menús, productos y servicios,
 * anuncios, y tarjetas de eventos y de empleos vinculadas a sus módulos». Todo
 * eso es UN post: la variedad la resuelve `PostCard`, que ya sabe pintar texto,
 * carrusel, video, encuesta, música y ficha embebida. Acá no se inventa una
 * tarjeta nueva para leer una publicación.
 *
 * QUÉ ES UNA PUBLICACIÓN DE NEGOCIO: un `posts` cuyo `entity_listing_id` apunta
 * a una ficha `kind='business'` (0023). No hay una tabla de "posts de negocio"
 * ni un `kind` nuevo — es el mismo post, publicado COMO el negocio.
 *
 * ── HERMANA DE `lib/profesionales/entity-posts.ts`, A PROPÓSITO ─────────────
 * Es la misma lectura con otro `kind`, y las dos comparten hasta el último
 * criterio de visibilidad. No se factorizó en una función común porque los dos
 * módulos se están cableando en paralelo y un archivo compartido en medio sería
 * un archivo con dos dueños. Si las dos sobreviven al lote, unificarlas es un
 * refactor de diez líneas — y hasta entonces cada módulo puede moverse sin
 * romper al otro.
 *
 * ── EL JOIN, NO DOS PASOS ───────────────────────────────────────────────────
 * El scope "sólo posts de una ficha de negocio" se resuelve DENTRO de la base
 * con `listings!inner(id)`. La alternativa —traer antes todos los ids de fichas
 * de negocio del tenant y meterlos en un `.in(...)`— crece sin techo y termina
 * en el 414 que documenta `videos/queries.ts`: un `.in()` viaja en el
 * querystring y Kong corta cerca de los 8 KB. Con el join no viaja NINGÚN id.
 * Sin hint de FK porque `posts` tiene una sola clave foránea a `listings`
 * (`posts_entity_listing_id_fkey`, 0023).
 *
 * ── MISMA VISIBILIDAD QUE EL FEED "PARA TI" ─────────────────────────────────
 * Un post orgánico de entidad llega SÓLO a quien sigue esa ficha; con campaña
 * activa (`post_promotions`) llega a todos, con el chip "Publicidad". Es la
 * regla del feed y de /videos y de la pestaña hermana de Profesionales, y vale
 * igual acá: esta pestaña también es una superficie de descubrimiento. (La
 * pestaña Ofertas NO la aplica, y su archivo explica por qué: una vidriera de
 * descuentos filtrada por seguidores queda vacía justo para el recién llegado.)
 *
 * ── VA A NACER VACÍA, Y ESTÁ BIEN ───────────────────────────────────────────
 * El composer que escribe `entity_listing_id` se está cableando en paralelo.
 * Hasta que llegue, esta pestaña muestra su estado vacío contando qué va a
 * aparecer ahí — sin ofrecer un botón que hoy no lleva a ningún lado.
 */

type Supabase = SupabaseClient<Database>;

/**
 * Las mismas columnas del post + el join INNER a la ficha del negocio que lo
 * publica. `as typeof POST_COLUMNS` es el mismo truco que en `feed/queries.ts`:
 * el VALOR pide el embed a PostgREST; el TIPO se queda en las columnas que
 * `PostRow` ya declara.
 */
const SCOPED_POST_COLUMNS = `${POST_COLUMNS}, listings!inner(id)` as typeof POST_COLUMNS;

export const BUSINESS_POSTS_PAGE_SIZE = 8;

export interface BusinessPostsCursor {
  createdAt: string;
  id: string;
}

export interface BusinessPostsPage {
  items: PostCardModel[];
  /** Cursor keyset ya codificado de la próxima página, o null si no hay más. */
  nextCursor: string | null;
}

export async function fetchBusinessPostsPage(
  supabase: Supabase,
  args: {
    tenantId: string;
    viewerId: string | null;
    cursor: BusinessPostsCursor | null;
    pageSize?: number;
  },
): Promise<BusinessPostsPage> {
  const pageSize = args.pageSize ?? BUSINESS_POSTS_PAGE_SIZE;

  // Contexto del viewer: bloqueados, seguidos, promociones vigentes. Las tres
  // son independientes entre sí, así que van juntas.
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
    // Scope de módulo: sólo posts de una ficha PUBLICADA de kind='business'.
    // Filtro sobre el recurso embebido — con `!inner` en el select, filtrar la
    // ficha filtra el post. El tenant de la ficha no hace falta repetirlo: ya es
    // el mismo por policy (0023).
    .eq("listings.kind", "business")
    .eq("listings.status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);

  // Alcance "para vos" (los ids salen de la DB, no del cliente). PostgREST
  // AND-ea cada `.or()` de nivel superior con los demás filtros.
  query = query.or(feedPostVisibilityFilter(followedListingIds, [...promotedPostIds]));

  // Fuera lo que su autor ocultó del feed (0097).
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
    console.warn("[negocios] query de publicaciones falló", { code: error.code });
    return { items: [], nextCursor: null };
  }

  // Mismo doble cast que feed/queries.ts: `SCOPED_POST_COLUMNS` está anotado con
  // el tipo string de POST_COLUMNS, así que supabase-js no puede derivar la
  // forma real de la fila. El contrato lo fija `PostRow`.
  const rows = (data ?? []) as unknown as PostRow[];
  const pageRows = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;

  if (pageRows.length === 0) return { items: [], nextCursor: null };

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
