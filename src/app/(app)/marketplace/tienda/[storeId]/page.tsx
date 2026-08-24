import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { EmptyState, Skeleton } from "@/components/ui";
import { allPhotoUrls, firstPhotoUrl } from "@/components/listings";
import { InlineMessageCta } from "@/components/listings/inline-message-cta";
import { ResumenPuntajeCard, fetchResenasDeAviso } from "@/components/resenas";
import { RESENAS_COPY } from "@/lib/resenas";
import {
  COPY,
  ProductCard,
  ProductGridSkeleton,
  StoreHeader,
  StoreOffNotice,
  businessCategoryDisplayLabel,
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
    .select(
      // store_verified: espejo público de Presencia Verificada (0039).
      // store_active: espejo público de la membresía de tienda (0048) — la app
      // lee ESTA columna, nunca store_memberships (que la RLS le esconde al
      // visitante). true = la tienda se muestra. `attrs` trae la categoría
      // (mismo lugar que category/condition de un producto).
      "id, tenant_id, kind, title, area_label, attrs, photos, status, created_by, created_at, store_verified, store_active",
    )
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

  const isOwner = Boolean(user && store.created_by === user.id);

  // MEMBRESÍA VENCIDA O CANCELADA ⇒ la vidriera no se muestra (§7).
  //
  // Corta ANTES de pedir productos y seguidores: no tiene sentido traer datos
  // de una tienda que no se va a pintar. No es un 404 —la tienda existe y
  // puede volver— ni un 500: es un estado claro, distinto para el dueño (qué
  // pasó y cómo volver) y para el visitante (que no tiene por qué enterarse
  // del estado de pago de un negocio ajeno).
  //
  // El dueño SÍ entra a su propia tienda apagada: necesita ver que sus
  // productos siguen ahí. El aviso de arriba le dice que nadie más los ve.
  if (!store.store_active && !isOwner) {
    return <StoreOffNotice isOwner={false} />;
  }

  const [
    { data: productRows, error },
    { count: followerCount },
    { data: myFollow },
    { data: owner },
    resenas,
  ] = await Promise.all([
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
    // Identidad de quien administra la tienda (fix badge 2026-08-24) — GRATIS,
    // distinta de `store_verified` (el plan pago). Ver seller-chip.tsx.
    store.created_by
      ? supabase.from("profiles").select("identity_verified").eq("id", store.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
    // Calificaciones (listing_review_stats, 0093): la tienda ES un listing
    // kind='business', así que reusa el mismo lector que ya usan Negocios y
    // Profesionales — sin escribir una consulta nueva para lo mismo.
    fetchResenasDeAviso(supabase, storeId, user?.id ?? null),
  ]);

  if (error) {
    console.warn("[marketplace] query de productos de tienda falló", { code: error.code });
  }

  const verified = store.store_verified;
  // `parseProductAttrs` es genérico para cualquier `attrs` con la clave
  // `category` (producto o negocio comparten el mismo nombre de campo) — acá
  // sólo se usa esa parte; `storeListingId`/`condition`/`fulfillment` no
  // aplican a una tienda y vuelven vacíos, sin efecto.
  const categoryLabel = businessCategoryDisplayLabel(parseProductAttrs(store.attrs).category);

  const identityVerified = owner?.identity_verified ?? false;

  const storeModel: StoreHeaderModel = {
    id: store.id,
    name: store.title,
    areaLabel: store.area_label,
    photoUrl: firstPhotoUrl(store.photos),
    followerCount: followerCount ?? 0,
    initialFollowing: Boolean(myFollow),
    verified,
    identityVerified,
    categoryLabel,
  };

  const cards: ProductCardModel[] = (productRows ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    priceLabel: formatProductPrice(row.price_amount, row.price_currency, tenant.locale),
    category: parseProductAttrs(row.attrs).category,
    photoUrl: firstPhotoUrl(row.photos),
    // Tocar la foto abre el visor con todas, sin salir de la vidriera.
    photos: allPhotoUrls(row.photos),
    seller: { kind: "store", name: store.title, storeId: store.id, verified, identityVerified },
  }));

  return (
    <div>
      {/* El dueño ve su tienda apagada con sus productos intactos y un camino
          de vuelta; nadie más llega hasta acá (se corta más arriba). */}
      {!store.store_active && isOwner && (
        <div className="mb-4">
          <StoreOffNotice isOwner />
        </div>
      )}

      <StoreHeader store={storeModel} />

      {/* Calificaciones (spec cliente) — mismo componente que ya usan Negocios
          y Profesionales para la MISMA tabla (listing_review_stats, 0093): una
          tienda es un listing kind='business' como cualquier otro. Sólo el
          resumen, no la lista completa de reseñas ni el formulario para dejar
          una — eso sigue viviendo en /negocios/[id] para el mismo aviso. */}
      <section className="mt-6">
        <h2 className="mb-2 font-display text-lg font-bold text-foreground">
          {RESENAS_COPY.titulo}
        </h2>
        <ResumenPuntajeCard resumen={resenas.resumen} reparto={resenas.reparto} />
      </section>

      {/* Escribirle a la tienda sin salir de su vidriera. El destinatario es el
          listing kind='business': request_contact resuelve a su dueño. Sin
          dueño con cuenta (negocio de seed) no hay a quién escribirle. */}
      {store.created_by && !isOwner && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {COPY.store.messageTitle}
          </h2>
          <InlineMessageCta
            listingId={store.id}
            isLoggedIn={Boolean(user)}
            nextPath={`/marketplace/tienda/${store.id}`}
            label={COPY.store.messageCta}
            placeholder={COPY.store.messagePlaceholder}
          />
        </section>
      )}

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
        <Skeleton className="mb-2 h-6 w-32" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
      <div className="mt-6">
        <Skeleton className="mb-3 h-6 w-48" />
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
