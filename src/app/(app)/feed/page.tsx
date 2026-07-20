import { Suspense } from "react";
import Link from "next/link";
import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, EmptyState, buttonVariants } from "@/components/ui";
import {
  ListingCard,
  decodeCursor,
  encodeCursor,
} from "@/components/listings";
import {
  COPY,
  FeedListingCard,
  FeedSkeleton,
  FeedTabs,
  GuideCard,
  PostCard,
  PostComposer,
  feedPostVisibilityFilter,
  parseTab,
  type ComposerEntity,
  type FeedItem,
  type FeedTabId,
  type GuideCardModel,
} from "@/components/feed";
import { ParaVos, ParaVosSkeleton } from "@/components/matching";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
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

export const metadata = { title: "Feed" };

const PAGE_SIZE = 8;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function FeedPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tab = parseTab(firstValue(sp.tab) || undefined);
  const cursorRaw = firstValue(sp.cursor);

  return (
    <Suspense key={`${tab}|${cursorRaw}`} fallback={<PageSkeleton tab={tab} />}>
      <FeedContent tab={tab} cursorRaw={cursorRaw} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed): datos reales con la RLS del usuario
// ---------------------------------------------------------------------------

async function FeedContent({ tab, cursorRaw }: { tab: FeedTabId; cursorRaw: string }) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Zona + identidad del usuario para el header y el composer.
  let viewerName = "";
  let viewerAvatarUrl: string | null = null;
  let userArea: string | null = null;
  // Entidades propias publicadas → selector "Publicar como" del composer.
  let myEntities: ComposerEntity[] = [];
  if (user) {
    const [{ data: profile }, { data: entityRows }] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, avatar_url, area_label")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("listings")
        .select("id, title, kind")
        .eq("tenant_id", tenant.id)
        .eq("created_by", user.id)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    viewerName = profile?.display_name ?? "";
    viewerAvatarUrl = profile?.avatar_url ?? null;
    userArea = profile?.area_label ?? null;
    myEntities = (entityRows ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
    }));
  }

  const cursor = decodeCursor(cursorRaw || undefined);
  const isFirstPage = !cursor;

  return (
    <>
      <header className="mb-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.header.title}
        </h1>
        <p className="mt-0.5 text-sm text-foreground-secondary">
          {userArea ? COPY.header.subtitleNearArea(userArea) : COPY.header.subtitleDefault}
        </p>
      </header>

      <FeedTabs active={tab} />

      <div className="mt-4 flex flex-col gap-4">
        {tab === "para-ti" ? (
          <>
            {user ? (
              <PostComposer
                viewerName={viewerName}
                viewerAvatarUrl={viewerAvatarUrl}
                entities={myEntities}
              />
            ) : (
              <ComposerInvite />
            )}
            {/* Matching "Para vos" (módulo MATCHING): solo logueados; primera página. */}
            {user && isFirstPage && (
              <Suspense fallback={<ParaVosSkeleton />}>
                <ParaVos userId={user.id} />
              </Suspense>
            )}
            <ParaTiFeed
              tenantId={tenant.id}
              locale={tenant.locale}
              viewerId={user?.id ?? null}
              cursor={cursor}
              isFirstPage={isFirstPage}
            />
          </>
        ) : (
          <ListingsFeed
            tab={tab}
            tenantId={tenant.id}
            locale={tenant.locale}
            viewerId={user?.id ?? null}
            cursor={cursor}
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// "Para ti": mezcla server-side de posts + listings recientes + 1 guía (§4.b)
// ---------------------------------------------------------------------------

async function ParaTiFeed({
  tenantId,
  locale,
  viewerId,
  cursor,
  isFirstPage,
}: {
  tenantId: string;
  locale: string;
  viewerId: string | null;
  cursor: { createdAt: string; id: string } | null;
  isFirstPage: boolean;
}) {
  const supabase = await createClient();
  // Contexto del viewer para el alcance del feed (feedback cliente 2026-07-19):
  // bloqueados (fuera), entidades que sigue (sus posts orgánicos entran) y set
  // de posts con campaña activa (entran para todos, con chip "Publicidad").
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

  // Nunca mostrar en "Para ti" contenido de gente que el viewer bloqueó (§ contrato
  // bloqueo). Aplica también a los posts de entidad: author_id es SIEMPRE la
  // persona detrás de la entidad, así que el mismo filtro los cubre. El or()
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

  // Los avisos de una persona bloqueada tampoco aparecen (misma promesa que
  // los posts; created_by null = seed legal, se preserva).
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
    isFirstPage
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
    return (
      <EmptyState
        illustration="/images/empty-state-search.png"
        title={COPY.feed.emptyParaTiTitle}
        message={COPY.feed.emptyParaTiMessage}
        action={
          <Link
            href="/publicar"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.feed.emptyParaTiCta}
          </Link>
        }
      />
    );
  }

  const lastEntry = pageEntries[pageEntries.length - 1];

  return (
    <>
      {items.map((item) => {
        switch (item.type) {
          case "post":
            return (
              <PostCard
                key={`post-${item.id}`}
                post={item.post}
                tenantId={tenantId}
                viewerId={viewerId}
              />
            );
          case "listing-property":
            return <ListingCard key={`listing-${item.id}`} listing={item.listing} />;
          case "listing":
            return <FeedListingCard key={`listing-${item.id}`} listing={item.listing} />;
          case "guide":
            return <GuideCard key={item.id} guide={item.guide} />;
        }
      })}

      {hasMore && lastEntry && (
        <Link
          href={`/feed?cursor=${encodeCursor(lastEntry.createdAt, lastEntry.id)}`}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
        >
          {COPY.feed.loadMore}
          <CaretDown size={16} aria-hidden="true" />
        </Link>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tabs de listings por kind (Propiedades | Negocios | Profesionales | Eventos)
// ---------------------------------------------------------------------------

const TAB_KIND: Partial<Record<FeedTabId, string>> = {
  propiedades: "property",
  negocios: "business",
  profesionales: "professional",
  eventos: "event",
};

async function ListingsFeed({
  tab,
  tenantId,
  locale,
  viewerId,
  cursor,
}: {
  tab: FeedTabId;
  tenantId: string;
  locale: string;
  viewerId: string | null;
  cursor: { createdAt: string; id: string } | null;
}) {
  const supabase = await createClient();
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

  // Avisos de personas bloqueadas fuera de todos los tabs (created_by null =
  // seed legal, se preserva).
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
    return (
      <EmptyState
        illustration="/images/empty-state-search.png"
        title={COPY.feed.emptyListingsTitle}
        message={COPY.feed.emptyListingsMessage}
        action={
          <Link
            href="/publicar"
            className={buttonVariants({ variant: "outline", size: "md" })}
          >
            {COPY.feed.emptyListingsCta}
          </Link>
        }
      />
    );
  }

  const extras = await fetchListingExtras(supabase, tenantId, rows, locale);
  const lastRow = rows[rows.length - 1];

  return (
    <>
      {rows.map((row) =>
        row.kind === "property" ? (
          <ListingCard key={row.id} listing={toListingCardModel(row, extras, locale)} />
        ) : (
          <FeedListingCard key={row.id} listing={toFeedListingModel(row, extras, locale)} />
        ),
      )}

      {hasMore && lastRow && (
        <Link
          href={`/feed?tab=${tab}&cursor=${encodeCursor(lastRow.created_at, lastRow.id)}`}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
        >
          {COPY.feed.loadMore}
          <CaretDown size={16} aria-hidden="true" />
        </Link>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Invitación para anónimos (arriba del feed, en lugar del composer)
// ---------------------------------------------------------------------------

function ComposerInvite() {
  return (
    <BezelCard variant="featured" coreClassName="flex flex-col gap-3 p-5">
      <div>
        <h2 className="font-display text-lg font-bold text-foreground">
          {COPY.inviteCard.title}
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.inviteCard.body}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <Link
          href="/registro"
          className={buttonVariants({ variant: "primary", size: "sm" })}
        >
          {COPY.inviteCard.cta}
        </Link>
        <Link
          href="/entrar?next=/feed"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {COPY.inviteCard.secondary}
        </Link>
      </div>
    </BezelCard>
  );
}

// ---------------------------------------------------------------------------
// Fallback de Suspense: header + tabs + shimmer (§5.2)
// ---------------------------------------------------------------------------

function PageSkeleton({ tab }: { tab: FeedTabId }) {
  return (
    <div aria-busy="true">
      <header className="mb-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.header.title}
        </h1>
        <p className="mt-0.5 text-sm text-foreground-secondary">
          {COPY.header.subtitleDefault}
        </p>
      </header>
      <FeedTabs active={tab} />
      <div className="mt-4">
        <FeedSkeleton withComposer={tab === "para-ti"} />
      </div>
    </div>
  );
}
