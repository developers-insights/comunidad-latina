import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { EmptyState, Skeleton } from "@/components/ui";
import { firstPhotoUrl } from "@/components/listings";
import {
  COPY,
  ProductCard,
  ProductGridSkeleton,
  StoreHeader,
  formatProductPrice,
  parseProductAttrs,
  type ProductCardModel,
  type StoreHeaderModel,
} from "@/components/marketplace";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";

type Params = Promise<{ storeId: string }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTS_LIMIT = 60;

/**
 * Lectura de la tienda, cache()-eada por request (patrón propiedades/[id] y
 * marketplace/[id]): generateMetadata y el cuerpo comparten la misma fila.
 * La tienda ES un listing kind='business' — RLS ya limita qué filas existen
 * para este usuario (published | propia | staff).
 */
const fetchStoreById = cache(async (id: string) => {
  const supabase = await createClient();
  return supabase
    .from("listings")
    .select("id, tenant_id, kind, title, area_label, photos, status, created_by, created_at")
    .eq("id", id)
    .eq("kind", "business")
    .maybeSingle();
});

export async function generateMetadata({ params }: { params: Params }) {
  const { storeId } = await params;
  if (!UUID_RE.test(storeId)) return { title: "Tienda" };
  const { data } = await fetchStoreById(storeId);
  return { title: data?.title ?? "Tienda" };
}

export default async function TiendaPage({ params }: { params: Params }) {
  const { storeId } = await params;
  if (!UUID_RE.test(storeId)) notFound();

  return (
    <Suspense fallback={<PageSkeleton />}>
      <TiendaContent storeId={storeId} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed): datos reales con RLS del usuario
// ---------------------------------------------------------------------------

async function TiendaContent({ storeId }: { storeId: string }) {
  const [tenant, supabase, { data: store }] = await Promise.all([
    getTenant(),
    createClient(),
    fetchStoreById(storeId),
  ]);

  if (!store || store.tenant_id !== tenant.id) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: productRows, error }, { count: followerCount }, { data: myFollow }] =
    await Promise.all([
      supabase
        .from("listings")
        .select("id, title, price_amount, price_currency, attrs, photos, created_at")
        .eq("tenant_id", tenant.id)
        .eq("kind", "product")
        .eq("status", "published")
        .eq("attrs->>store_listing_id", storeId)
        .order("created_at", { ascending: false })
        .limit(PRODUCTS_LIMIT),
      supabase
        .from("follows")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .eq("target_kind", "listing")
        .eq("target_id", storeId),
      user
        ? supabase
            .from("follows")
            .select("id")
            .eq("tenant_id", tenant.id)
            .eq("follower_id", user.id)
            .eq("target_kind", "listing")
            .eq("target_id", storeId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  if (error) {
    console.warn("[marketplace] query de productos de tienda falló", { code: error.code });
  }

  const storeModel: StoreHeaderModel = {
    id: store.id,
    name: store.title,
    areaLabel: store.area_label,
    photoUrl: firstPhotoUrl(store.photos),
    followerCount: followerCount ?? 0,
    initialFollowing: Boolean(myFollow),
  };

  const cards: ProductCardModel[] = (productRows ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    priceLabel: formatProductPrice(row.price_amount, row.price_currency, tenant.locale),
    category: parseProductAttrs(row.attrs).category,
    photoUrl: firstPhotoUrl(row.photos),
    store: { id: store.id, name: store.title },
  }));

  return (
    <div>
      <StoreHeader store={storeModel} />

      <section className="mt-6">
        <h2 className="mb-3 font-display text-lg font-bold text-foreground">
          {COPY.store.productsTitle}
        </h2>
        {cards.length === 0 ? (
          <EmptyState
            title={COPY.store.emptyProductsTitle}
            message={COPY.store.emptyProductsMessage}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {cards.map((card) => (
              <ProductCard key={card.id} product={card} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fallback: silueta de la cabecera + grilla (shimmer, §5.2)
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <div className="flex flex-col gap-4">
        <Skeleton className="aspect-video w-full rounded-xl" />
        <div>
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/3" />
        </div>
        <Skeleton className="h-11 w-40 rounded-full" />
      </div>
      <div className="mt-6">
        <Skeleton className="mb-3 h-6 w-48" />
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
