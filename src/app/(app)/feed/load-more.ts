"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { getTenant } from "@/lib/tenant/resolve";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { decodeCursor, encodeCursor } from "@/components/listings";
import {
  feedPostVisibilityFilter,
  parseTab,
  type FeedItem,
  type FeedTabId,
  type GuideCardModel,
} from "@/components/feed";
import {
  LISTING_COLUMNS,
  POST_COLUMNS,
  fetchActivePromotedPostIds,
  fetchAuthorViews,
  fetchBlockedIds,
  fetchEntityViews,
  fetchFollowedListingIds,
  fetchListingExtras,
  fetchViewerLikes,
  toFeedListingModel,
  toListingCardModel,
  toPostCardModel,
  type ListingRow,
  type PostRow,
} from "./queries";

/**
 * Módulo FLUIDEZ — paginación del feed como server action.
 *
 * Extraído de page.tsx: ANTES `ParaTiFeed`/`ListingsFeed` armaban la query Y el
 * JSX en la misma función, así que la única forma de pedir "la próxima página"
 * era un <Link href="?cursor=..."> que navegaba y repintaba TODA la ruta. Acá
 * vive la lógica de "armar una página de items" pelada de JSX — la llaman
 * TANTO page.tsx (primera página, server→server, sin red) COMO feed-list.tsx
 * (scroll infinito, vía esta MISMA server action) — una sola fuente de verdad
 * para el keyset, nunca dos implementaciones que puedan desincronizarse.
 *
 * SEGURIDAD (guía server-actions.md): esta action es un POST alcanzable por
 * cualquiera, no solo por el scroll de la UI. Por eso NUNCA acepta tenantId ni
 * viewerId del caller — los resuelve siempre acá adentro (getTenant/JWT), y
 * `tab` se re-normaliza con parseTab() por si alguien la invoca a mano con un
 * string fuera del union. Es una LECTURA (nunca muta ni revalida cache), así
 * que no hace falta autenticar: RLS ya decide qué ve cada quien.
 */

const PAGE_SIZE = 8;

// Espeja el flag de page.tsx (oculto por pedido cliente 2026-07-20): la guía
// destacada del feed no se intercala hoy. Booleano explícito por la misma
// razón que allá — no romper el narrowing de abajo con el literal `false`.
const GUIDES_IN_FEED_ENABLED: boolean = false;

const TAB_KIND: Partial<Record<FeedTabId, string>> = {
  propiedades: "property",
  negocios: "business",
  profesionales: "professional",
  eventos: "event",
};

type Supabase = SupabaseClient<Database>;
type Cursor = { createdAt: string; id: string } | null;

export interface FeedPageResult {
  items: FeedItem[];
  nextCursor: string | null;
}

/**
 * Punto de entrada ÚNICO para pedir una página del feed (cualquier tab).
 * `cursor` viaja como el mismo string codificado que antes iba en `?cursor=`
 * (o `null` para la primera página) — mismo contrato, ahora sin navegar.
 */
export async function fetchFeedPageAction(input: {
  tab: FeedTabId;
  cursor: string | null;
}): Promise<FeedPageResult> {
  const tab = parseTab(input.tab);
  const cursor = decodeCursor(input.cursor ?? undefined);

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  // Lectura respaldada por RLS, no una mutación: la verificación LOCAL del JWT
  // (WebCrypto, sin round-trip al Auth server) alcanza y evita pagar esa
  // latencia en CADA scroll — mismo criterio que notificaciones/entrar.
  const viewerId = await getAuthUserId();

  if (tab === "para-ti") {
    return loadParaTiPage({
      supabase,
      tenantId: tenant.id,
      locale: tenant.locale,
      viewerId,
      cursor,
    });
  }
  return loadListingsPage({
    supabase,
    tab,
    tenantId: tenant.id,
    locale: tenant.locale,
    viewerId,
    cursor,
  });
}

// ---------------------------------------------------------------------------
// "Para ti": mezcla server-side de posts + listings recientes + 1 guía (§4.b)
// (idéntico al que vivía en page.tsx — ver ese historial para el porqué de
// cada `.or()`; acá solo cambia el remate: datos, no JSX).
// ---------------------------------------------------------------------------

async function loadParaTiPage({
  supabase,
  tenantId,
  locale,
  viewerId,
  cursor,
}: {
  supabase: Supabase;
  tenantId: string;
  locale: string;
  viewerId: string | null;
  cursor: Cursor;
}): Promise<FeedPageResult> {
  const isFirstPage = !cursor;

  const [blockedIds, followedListingIds, promotedPostIds] = await Promise.all([
    fetchBlockedIds(supabase, viewerId),
    fetchFollowedListingIds(supabase, viewerId),
    fetchActivePromotedPostIds(supabase, tenantId),
  ]);

  let postsQuery = supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  // Alcance "para vos": personal (entity null) + entidades que sigo + posts
  // promocionados (a todos). PostgREST AND-ea cada `.or()` de nivel superior, así
  // que este grupo convive con el de bloqueados y el keyset.
  postsQuery = postsQuery.or(
    feedPostVisibilityFilter(followedListingIds, [...promotedPostIds]),
  );

  // Nunca mostrar en "Para ti" contenido de gente que el viewer bloqueó. El or()
  // preserva los posts de autor anónimo (cuenta borrada → author_id null): un
  // NOT IN pelado los filtraría por la semántica de NULL.
  if (blockedIds.size > 0) {
    postsQuery = postsQuery.or(
      `author_id.is.null,author_id.not.in.(${[...blockedIds].join(",")})`,
    );
  }

  let listingsQuery = supabase
    .from("listings")
    .select(LISTING_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (blockedIds.size > 0) {
    listingsQuery = listingsQuery.or(
      `created_by.is.null,created_by.not.in.(${[...blockedIds].join(",")})`,
    );
  }

  if (cursor) {
    const keysetFilter = `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`;
    postsQuery = postsQuery.or(keysetFilter);
    listingsQuery = listingsQuery.or(keysetFilter);
  }

  const [postsResult, listingsResult, guideResult] = await Promise.all([
    postsQuery,
    listingsQuery,
    isFirstPage && GUIDES_IN_FEED_ENABLED
      ? supabase
          .from("guides")
          .select("slug, title, summary, reading_minutes")
          .eq("status", "published")
          .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
          .order("published_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (postsResult.error) {
    console.warn("[feed] query de posts falló", { code: postsResult.error.code });
  }
  if (listingsResult.error) {
    console.warn("[feed] query de listings falló", { code: listingsResult.error.code });
  }

  const postRows = (postsResult.data ?? []) as PostRow[];
  const listingRows = (listingsResult.data ?? []) as ListingRow[];

  // Merge por (created_at, id) desc — ids uuid_v7, el desempate es estable.
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

  const pageEntries = merged.slice(0, PAGE_SIZE);
  const hasMore = merged.length > PAGE_SIZE;

  // Batches: autores+likes de los posts visibles, extras de listings visibles.
  const visiblePosts = pageEntries.filter((entry) => entry.type === "post");
  const visibleListings = pageEntries
    .filter((entry) => entry.type === "listing")
    .map((entry) => entry.row as ListingRow);

  const now = new Date();
  const entityListingIds = visiblePosts
    .map((entry) => (entry.row as PostRow).entity_listing_id)
    .filter((id): id is string => Boolean(id));

  const [authors, likedIds, listingExtras, entityById] = await Promise.all([
    fetchAuthorViews(
      supabase,
      visiblePosts
        .map((entry) => (entry.row as PostRow).author_id)
        .filter((id): id is string => Boolean(id)),
    ),
    fetchViewerLikes(
      supabase,
      viewerId,
      visiblePosts.map((entry) => entry.id),
    ),
    fetchListingExtras(supabase, tenantId, visibleListings, locale),
    fetchEntityViews(supabase, entityListingIds),
  ]);

  const items: FeedItem[] = pageEntries.map((entry) => {
    if (entry.type === "post") {
      const postRow = entry.row as PostRow;
      return {
        type: "post",
        createdAt: entry.createdAt,
        id: entry.id,
        post: toPostCardModel(postRow, authors, likedIds, now, {
          entity: postRow.entity_listing_id
            ? (entityById.get(postRow.entity_listing_id) ?? null)
            : null,
          isPromoted: promotedPostIds.has(postRow.id),
        }),
      };
    }
    const row = entry.row as ListingRow;
    if (row.kind === "property") {
      return {
        type: "listing-property",
        createdAt: entry.createdAt,
        id: entry.id,
        listing: toListingCardModel(row, listingExtras, locale),
      };
    }
    return {
      type: "listing",
      createdAt: entry.createdAt,
      id: entry.id,
      listing: toFeedListingModel(row, listingExtras, locale),
    };
  });

  // Guía destacada intercalada (solo primera página) — formato editorial §4.b.
  const guideRow = guideResult.data as
    | { slug: string; title: string; summary: string | null; reading_minutes: number | null }
    | null;
  const guide: GuideCardModel | null = guideRow
    ? {
        slug: guideRow.slug,
        title: guideRow.title,
        summary: guideRow.summary,
        readingMinutes: guideRow.reading_minutes,
      }
    : null;
  if (guide && items.length > 0) {
    items.splice(Math.min(2, items.length), 0, {
      type: "guide",
      createdAt: "",
      id: `guide-${guide.slug}`,
      guide,
    });
  }

  if (items.length === 0) {
    return { items: [], nextCursor: null };
  }

  const lastEntry = pageEntries[pageEntries.length - 1];
  const nextCursor = hasMore && lastEntry ? encodeCursor(lastEntry.createdAt, lastEntry.id) : null;
  return { items, nextCursor };
}

// ---------------------------------------------------------------------------
// Tabs de listings por kind (Propiedades | Negocios | Profesionales | Eventos)
// ---------------------------------------------------------------------------

async function loadListingsPage({
  supabase,
  tab,
  tenantId,
  locale,
  viewerId,
  cursor,
}: {
  supabase: Supabase;
  tab: FeedTabId;
  tenantId: string;
  locale: string;
  viewerId: string | null;
  cursor: Cursor;
}): Promise<FeedPageResult> {
  const kind = TAB_KIND[tab] ?? "property";
  const blockedIds = await fetchBlockedIds(supabase, viewerId);

  let query = supabase
    .from("listings")
    .select(LISTING_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (blockedIds.size > 0) {
    query = query.or(
      `created_by.is.null,created_by.not.in.(${[...blockedIds].join(",")})`,
    );
  }

  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[feed] query de listings del tab falló", { code: error.code });
  }

  const rows = ((data ?? []) as ListingRow[]).slice(0, PAGE_SIZE);
  const hasMore = (data ?? []).length > PAGE_SIZE;

  if (rows.length === 0) {
    return { items: [], nextCursor: null };
  }

  const extras = await fetchListingExtras(supabase, tenantId, rows, locale);
  const lastRow = rows[rows.length - 1];

  const items: FeedItem[] = rows.map((row) =>
    row.kind === "property"
      ? {
          type: "listing-property",
          createdAt: row.created_at,
          id: row.id,
          listing: toListingCardModel(row, extras, locale),
        }
      : {
          type: "listing",
          createdAt: row.created_at,
          id: row.id,
          listing: toFeedListingModel(row, extras, locale),
        },
  );

  const nextCursor = hasMore && lastRow ? encodeCursor(lastRow.created_at, lastRow.id) : null;
  return { items, nextCursor };
}
