import { Suspense } from "react";
import Link from "next/link";
import { CaretDown, Plus } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, Skeleton, buttonVariants } from "@/components/ui";
import { decodeCursor, encodeCursor, firstPhotoUrl } from "@/components/listings";
import {
  CategoryChips,
  COPY,
  MarketplaceOwnerBanner,
  ProductCard,
  ProductGridSkeleton,
  formatProductPrice,
  isProductCategory,
  parseProductAttrs,
  type ProductCardModel,
} from "@/components/marketplace";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

export const metadata = { title: "Marketplace" };

const PAGE_SIZE = 12;
const C = COPY.list;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Filters {
  categoria: string;
  cursor: string;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const categoriaRaw = firstValue(sp.categoria).slice(0, 40);
  return {
    categoria: isProductCategory(categoriaRaw) ? categoriaRaw : "",
    cursor: firstValue(sp.cursor),
  };
}

export default async function MarketplacePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  return (
    <Suspense key={JSON.stringify(filters)} fallback={<PageSkeleton />}>
      <MarketplaceContent filters={filters} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed): datos reales con RLS del usuario
// ---------------------------------------------------------------------------

async function MarketplaceContent({ filters }: { filters: Filters }) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // -------------------------------------------------------------------------
  // Query principal: keyset pagination (created_at,id), filtro por categoría
  // -------------------------------------------------------------------------
  let query = supabase
    .from("listings")
    .select("id, title, price_amount, price_currency, attrs, photos, created_at")
    .eq("tenant_id", tenant.id)
    .eq("kind", "product")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (filters.categoria) {
    query = query.eq("attrs->>category", filters.categoria);
  }
  const cursor = decodeCursor(filters.cursor || undefined);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data: rows, error } = await query;
  if (error) {
    console.warn("[marketplace] query de productos falló", { code: error.code });
  }

  const pageRows = (rows ?? []).slice(0, PAGE_SIZE);
  const hasMore = (rows ?? []).length > PAGE_SIZE;

  // -------------------------------------------------------------------------
  // Batch: nombre de cada tienda (attrs.store_listing_id) + ¿el viewer tiene
  // un negocio publicado? (banner "para dueños", en paralelo con lo de arriba)
  // -------------------------------------------------------------------------
  const storeIds = [
    ...new Set(
      pageRows
        .map((row) => parseProductAttrs(row.attrs).storeListingId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [storesResult, ownsStoreResult] = await Promise.all([
    storeIds.length > 0
      ? supabase
          .from("listings")
          .select("id, title")
          .eq("tenant_id", tenant.id)
          .eq("kind", "business")
          .in("id", storeIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    user
      ? supabase
          .from("listings")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("kind", "business")
          .eq("created_by", user.id)
          .eq("status", "published")
      : Promise.resolve({ count: 0 }),
  ]);

  const storeNameById = new Map((storesResult.data ?? []).map((s) => [s.id, s.title]));
  const ownsStore = (ownsStoreResult.count ?? 0) > 0;

  const cards: ProductCardModel[] = pageRows.map((row) => {
    const attrs = parseProductAttrs(row.attrs);
    return {
      id: row.id,
      title: row.title,
      priceLabel: formatProductPrice(row.price_amount, row.price_currency, tenant.locale),
      category: attrs.category,
      photoUrl: firstPhotoUrl(row.photos),
      store: attrs.storeListingId
        ? {
            id: attrs.storeListingId,
            name: storeNameById.get(attrs.storeListingId) ?? "Tienda de la comunidad",
          }
        : null,
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextParams = new URLSearchParams();
  if (filters.categoria) nextParams.set("categoria", filters.categoria);
  if (hasMore && lastRow) nextParams.set("cursor", encodeCursor(lastRow.created_at, lastRow.id));

  return (
    <>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {C.title}
          </h1>
          <p className="mt-0.5 text-sm text-foreground-secondary">{C.subtitle}</p>
        </div>
        <Link
          href="/marketplace/publicar"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
        >
          <Plus size={16} aria-hidden="true" />
          {C.publishCta}
        </Link>
      </header>

      {ownsStore && <MarketplaceOwnerBanner />}

      <CategoryChips className={cn(ownsStore ? "mt-4" : "", "mb-5")} />

      {cards.length === 0 ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={filters.categoria ? C.emptyFilteredTitle : C.emptyTitle}
          message={filters.categoria ? C.emptyFilteredMessage : C.emptyMessage}
          action={
            <Link
              href="/marketplace/publicar"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              <Plus size={18} aria-hidden="true" />
              {C.emptyPublishCta}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {cards.map((card) => (
              <ProductCard key={card.id} product={card} />
            ))}
          </div>

          {hasMore && (
            <Link
              href={`/marketplace?${nextParams.toString()}`}
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
            >
              {C.loadMore}
              <CaretDown size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Fallback: silueta del header + chips + grilla (shimmer, §5.2)
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {C.title}
          </h1>
          <Skeleton className="mt-1.5 h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-32 rounded-md" />
      </header>
      <div className="mb-5 flex gap-2">
        <Skeleton className="h-11 w-16 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-24 rounded-full" />
      </div>
      <ProductGridSkeleton />
    </div>
  );
}
