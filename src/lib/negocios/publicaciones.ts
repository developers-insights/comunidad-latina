import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import {
  LISTING_COLUMNS,
  POST_COLUMNS,
  VISIBLE_POSTS_FILTER,
  fetchActivePromotedPostIds,
  fetchAuthorViews,
  fetchBlockedIds,
  fetchEntityViews,
  fetchFollowedListingIds,
  fetchListingExtras,
  fetchViewerLikes,
  toFeedListingModel,
  toPostCardModel,
  type ListingRow,
  type PostRow,
} from "@/app/(app)/feed/queries";
import {
  feedPostVisibilityFilter,
  type FeedListingModel,
  type PostCardModel,
} from "@/components/feed";
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

/**
 * UN RENGLÓN DE LA PESTAÑA. Son dos formas y no una porque la spec pide dos
 * cosas distintas en el mismo listado: «fotos, videos, textos, menús, productos
 * y servicios, anuncios» —que son publicaciones— y «tarjetas de eventos
 * vinculadas con Eventos, tarjetas de empleos vinculadas con Empleos», que NO
 * son publicaciones: son avisos de otro módulo que este negocio publicó.
 *
 * Modelarlas como un post con foto habría sido más fácil de renderizar y peor
 * de todo lo demás: un evento tiene fecha, cupo y "Quiero ir", y un empleo tiene
 * sueldo y "Aplicar". Aplanarlos a un post los deja sin su acción, que es
 * exactamente lo que alguien vino a hacer.
 */
export type BusinessFeedItem =
  | { type: "post"; createdAt: string; id: string; post: PostCardModel }
  | { type: "listing"; createdAt: string; id: string; listing: FeedListingModel };

export interface BusinessPostsPage {
  items: BusinessFeedItem[];
  /** Cursor keyset ya codificado de la próxima página, o null si no hay más. */
  nextCursor: string | null;
}

/**
 * Los verticales que un negocio publica en OTRO módulo y que la spec pide ver
 * acá como tarjeta vinculada. El vínculo es `listings.business_listing_id`
 * (0107 para empleos, 0117 para eventos): no se deduce del dueño, porque una
 * misma persona puede tener la parrilla y la peluquería y sus avisos no son
 * intercambiables.
 */
const VERTICALES_VINCULADOS = ["event", "job"] as const;

export async function fetchBusinessPostsPage(
  supabase: Supabase,
  args: {
    tenantId: string;
    viewerId: string | null;
    cursor: BusinessPostsCursor | null;
    pageSize?: number;
    /** Locale de la comunidad — formatea el precio de las tarjetas vinculadas. */
    locale?: string;
  },
): Promise<BusinessPostsPage> {
  const pageSize = args.pageSize ?? BUSINESS_POSTS_PAGE_SIZE;
  const locale = args.locale ?? "es-US";

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
  //
  // El TERCER argumento no es opcional en la práctica: el dueño NO se sigue
  // a sí mismo, así que sin `viewerId` su propia publicación no entra por
  // ninguna de las otras ramas y la pestaña "Publicaciones" de su ficha le
  // aparece vacía — justo la pantalla donde va a mirar primero después de
  // publicar.
  query = query.or(feedPostVisibilityFilter(followedListingIds, [...promotedPostIds], args.viewerId));

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

  /**
   * EL SEGUNDO CARRIL: los eventos y empleos vinculados a alguna ficha de
   * negocio de esta comunidad. Va en paralelo con el de publicaciones y se
   * mezcla después por `(created_at, id)` — el mismo reparto que usa el feed
   * "Para ti" con sus dos carriles, y por el mismo motivo: la mezcla decide qué
   * entra en la página, así que tiene que pasar DESPUÉS de traer las dos listas.
   *
   * NO se le aplica `feedPostVisibilityFilter`. Un aviso publicado es público en
   * su propio módulo —cualquiera lo encuentra en /eventos o en /empleos— así que
   * esconderlo acá a quien no sigue la ficha no protegería nada y dejaría la
   * pestaña sin la mitad de lo que la spec pide. Lo que sí se respeta es el
   * bloqueo: no ver a alguien vale en todas las superficies.
   */
  let vinculadosQuery = supabase
    .from("listings")
    .select(LISTING_COLUMNS)
    .eq("tenant_id", args.tenantId)
    .eq("status", "published")
    .in("kind", [...VERTICALES_VINCULADOS])
    .not("business_listing_id", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);

  if (blockedIds.size > 0) {
    vinculadosQuery = vinculadosQuery.or(
      `created_by.is.null,created_by.not.in.(${[...blockedIds].join(",")})`,
    );
  }

  if (args.cursor) {
    vinculadosQuery = vinculadosQuery.or(
      `created_at.lt."${args.cursor.createdAt}",and(created_at.eq."${args.cursor.createdAt}",id.lt."${args.cursor.id}")`,
    );
  }

  const [{ data, error }, vinculados] = await Promise.all([query, vinculadosQuery]);
  if (error) {
    console.warn("[negocios] query de publicaciones falló", { code: error.code });
  }
  if (vinculados.error) {
    // Entorno sin la 0107/0117: la pestaña muestra las publicaciones y nada
    // más. Es menos de lo que la spec pide, pero es honesto y no rompe nada.
    console.warn("[negocios] query de eventos y empleos vinculados falló", {
      code: vinculados.error.code,
    });
  }
  if (error && vinculados.error) return { items: [], nextCursor: null };

  // Mismo doble cast que feed/queries.ts: `SCOPED_POST_COLUMNS` está anotado con
  // el tipo string de POST_COLUMNS, así que supabase-js no puede derivar la
  // forma real de la fila. El contrato lo fija `PostRow`.
  const postRows = (data ?? []) as unknown as PostRow[];
  const listingRows = (vinculados.data ?? []) as unknown as ListingRow[];

  /**
   * MEZCLA por `(created_at, id)` desc, calcada del feed "Para ti". Los ids son
   * uuid_v7, así que el desempate por id es estable y coincide con el orden que
   * ya usaron las dos consultas — sin eso, el keyset de la página siguiente
   * podría saltearse una fila que quedó justo en el borde.
   */
  const merged: Array<
    | { type: "post"; createdAt: string; id: string; row: PostRow }
    | { type: "listing"; createdAt: string; id: string; row: ListingRow }
  > = [
    ...postRows.map((row) => ({
      type: "post" as const,
      createdAt: row.created_at,
      id: row.id,
      row,
    })),
    ...listingRows.map((row) => ({
      type: "listing" as const,
      createdAt: row.created_at,
      id: row.id,
      row,
    })),
  ].sort((a, b) =>
    a.createdAt === b.createdAt
      ? b.id.localeCompare(a.id)
      : a.createdAt < b.createdAt
        ? 1
        : -1,
  );

  const pageEntries = merged.slice(0, pageSize);
  const hasMore = merged.length > pageSize;

  if (pageEntries.length === 0) return { items: [], nextCursor: null };

  const visiblePosts = pageEntries.filter((entry) => entry.type === "post");
  const visibleListings = pageEntries
    .filter((entry) => entry.type === "listing")
    .map((entry) => entry.row as ListingRow);

  const now = new Date();
  const entityListingIds = visiblePosts
    .map((entry) => (entry.row as PostRow).entity_listing_id)
    .filter((id): id is string => Boolean(id));
  const pageIds = visiblePosts.map((entry) => entry.id);

  // Los batches se piden sobre lo que SE VA A PINTAR, nunca sobre las dos
  // listas completas: la mitad de las filas que llegaron se descartó recién en
  // la mezcla de arriba.
  const [authors, likedIds, entityById, listingExtras] = await Promise.all([
    fetchAuthorViews(
      supabase,
      visiblePosts
        .map((entry) => (entry.row as PostRow).author_id)
        .filter((id): id is string => Boolean(id)),
    ),
    fetchViewerLikes(supabase, args.viewerId, pageIds),
    fetchEntityViews(supabase, entityListingIds),
    fetchListingExtras(supabase, args.tenantId, visibleListings, locale),
  ]);

  const items: BusinessFeedItem[] = pageEntries.map((entry) => {
    if (entry.type === "post") {
      const row = entry.row as PostRow;
      return {
        type: "post",
        createdAt: entry.createdAt,
        id: entry.id,
        post: toPostCardModel(row, authors, likedIds, now, {
          entity: row.entity_listing_id ? (entityById.get(row.entity_listing_id) ?? null) : null,
          isPromoted: promotedPostIds.has(row.id),
        }),
      };
    }
    return {
      type: "listing",
      createdAt: entry.createdAt,
      id: entry.id,
      listing: toFeedListingModel(entry.row as ListingRow, listingExtras, locale),
    };
  });

  const last = pageEntries[pageEntries.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  return { items, nextCursor };
}
