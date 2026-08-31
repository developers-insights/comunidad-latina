import { Suspense } from "react";
import Link from "next/link";
import { CaretDown, Plus } from "@phosphor-icons/react/dist/ssr";
import {
  Bubble,
  EmptyState,
  NavTabs,
  SectionCta,
  SectionHeading,
  Skeleton,
  buttonVariants,
  type NavTabItem,
} from "@/components/ui";
import { allPhotoUrls, decodeCursor, encodeCursor, firstPhotoUrl } from "@/components/listings";
import {
  CategoryChips,
  COPY,
  MarketplaceOwnerBanner,
  MarketplaceSearchBar,
  ProductCard,
  ProductGridSkeleton,
  StoreCard,
  StoreListSkeleton,
  businessCategoryDisplayLabel,
  formatProductPrice,
  isProductCategory,
  parseProductAttrs,
  sanitizeSearchQuery,
  type ProductCardModel,
  type StoreCardModel,
} from "@/components/marketplace";
import { fetchActiveListingCounts, fetchStoreRatings } from "@/lib/marketplace/store-directory";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { ZonaVacia } from "@/components/zona";
import { resolverVistaZona } from "@/lib/zona/server";
import { cn } from "@/lib/utils";
import {
  MARKETPLACE_TAB_IDS,
  MARKETPLACE_TAB_LABELS,
  marketplaceTabHref,
  parseMarketplaceTab,
  type MarketplaceTabId,
} from "../marketplace-tabs";

export const metadata = { title: "Marketplace" };

const PAGE_SIZE = 12;
const C = COPY.list;
const CS = COPY.storesList;

/** Acento + ícono 3D de la sección (los mismos del menú y de /buscar). */
const SECCION = {
  accent: "var(--accent-marketplace)",
  image: "/icons/menu/marketplace.webp",
  publicarHref: "/marketplace/publicar",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Filters {
  categoria: string;
  q: string;
  cursor: string;
}

interface StoreFilters {
  q: string;
  cursor: string;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const categoriaRaw = firstValue(sp.categoria).slice(0, 40);
  return {
    categoria: isProductCategory(categoriaRaw) ? categoriaRaw : "",
    q: sanitizeSearchQuery(firstValue(sp.q)),
    cursor: firstValue(sp.cursor),
  };
}

function parseStoreFilters(sp: Record<string, string | string[] | undefined>): StoreFilters {
  return {
    q: sanitizeSearchQuery(firstValue(sp.q)),
    cursor: firstValue(sp.cursor),
  };
}

/**
 * DOS PESTAÑAS (spec cliente: "Tiendas | Artículos") — ver marketplace-tabs.ts
 * para el porqué del orden visual vs. la pestaña por default. El resto del
 * ruteo sigue igual que antes de las pestañas: `?categoria=`/`?q=`/`?cursor=`
 * para Artículos, ahora sólo `?q=`/`?cursor=` para Tiendas — cada pestaña con
 * su propio Suspense y su propio skeleton, mismo patrón que ya tenía esta
 * página (streaming, key por filtros).
 */
export default async function MarketplacePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tab = parseMarketplaceTab(firstValue(sp.t));

  if (tab === "tiendas") {
    const filters = parseStoreFilters(sp);
    return (
      <Suspense key={`tiendas:${JSON.stringify(filters)}`} fallback={<StoresPageSkeleton />}>
        <MarketplaceStoresContent filters={filters} />
      </Suspense>
    );
  }

  const filters = parseFilters(sp);
  return (
    <Suspense key={`articulos:${JSON.stringify(filters)}`} fallback={<PageSkeleton />}>
      <MarketplaceContent filters={filters} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Cabecera + pestañas — no dependen de la DB, así que se pintan IGUAL (nunca
// un shimmer) tanto en el contenido real como en cada fallback. Es la misma
// idea que ya tenía este archivo para SectionHeading/SectionCta antes de que
// existieran las pestañas, extendida a la barra nueva.
// ---------------------------------------------------------------------------

function marketplaceTabItems(): NavTabItem[] {
  return MARKETPLACE_TAB_IDS.map((id) => ({
    id,
    label: MARKETPLACE_TAB_LABELS[id],
    href: marketplaceTabHref(id),
  }));
}

function MarketplaceTopBar({ tab }: { tab: MarketplaceTabId }) {
  return (
    <>
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={C.title}
        subtitle={C.subtitle}
      />
      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishProductTitle")}
        hint={t("sections", "publishProductHint")}
        className="mt-3"
      />
      <NavTabs items={marketplaceTabItems()} active={tab} label={C.tabsLabel} className="mt-5" />
    </>
  );
}

// ---------------------------------------------------------------------------
// ARTÍCULOS (streamed): datos reales con RLS del usuario
// ---------------------------------------------------------------------------

async function MarketplaceContent({ filters }: { filters: Filters }) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  /*
   * ── "TU ZONA" NO SE APLICA A ARTÍCULOS, Y ES DELIBERADO ───────────────────
   *
   * Verificado contra el código, no supuesto: `crearBorradorProducto`
   * (marketplace/publicar/actions.ts) inserta el listing SIN `area_label` —
   * no hay campo de zona en el formulario ni en su schema. O sea que HOY todos
   * los productos tienen `area_label` en NULL.
   *
   * Filtrar por zona acá no mostraría "menos artículos": no mostraría NINGUNO,
   * en todas las zonas, para todo el mundo que tenga una elegida. Un filtro que
   * vacía la pantalla entera no es un filtro, es una pantalla rota.
   *
   * La pestaña TIENDAS sí lo respeta: un `kind='business'` nace desde
   * /publicar, que sí pide la zona. Cuando el formulario de producto la pida,
   * la línea que falta acá es un `.in("area_label", vistaZona.areaLabels)`
   * igual al de las otras cinco verticales.
   */

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // -------------------------------------------------------------------------
  // Query principal: keyset pagination (created_at,id), filtro por categoría
  // -------------------------------------------------------------------------
  let query = supabase
    .from("listings")
    .select(
      "id, title, price_amount, price_currency, attrs, photos, created_at, created_by, publisher_name",
    )
    .eq("tenant_id", tenant.id)
    .eq("kind", "product")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (filters.categoria) {
    query = query.eq("attrs->>category", filters.categoria);
  }
  if (filters.q) {
    // Mismo índice FTS que /propiedades (listings.search, migración 0004):
    // título con más peso que descripción — funciona igual para kind='product'
    // (comentario de la 0024_marketplace_creators.sql: "un producto es un
    // listing kind='product', reusa moderación, fotos, RLS, boosts, FTS").
    query = query.textSearch("search", filters.q, { type: "websearch", config: "spanish" });
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
  // Batch del vendedor (§ split tiendas/particulares): por un lado el nombre de
  // cada TIENDA + si tiene Presencia Verificada (business_accounts por
  // listing_id — la relación ya existe en el schema, 0008); por otro el nombre
  // de quien publica cuando NO hay tienda detrás. Más el chequeo de si el
  // viewer tiene negocio (banner "para dueños"). Todo en paralelo, una vuelta.
  //
  // IDENTIDAD (fix badge 2026-08-24): `identity_verified` de quien está detrás
  // de cada aviso —el dueño de la tienda, o la propia persona si es
  // particular— viaja en el MISMO batch de `profiles` que ya se pedía para el
  // nombre del particular; para el dueño de tienda hace falta un batch propio
  // porque antes esa consulta no traía perfiles en absoluto.
  // -------------------------------------------------------------------------
  const attrsByRow = new Map(pageRows.map((row) => [row.id, parseProductAttrs(row.attrs)]));

  const storeIds = [
    ...new Set(
      pageRows
        .map((row) => attrsByRow.get(row.id)?.storeListingId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const privateOwnerIds = [
    ...new Set(
      pageRows
        .filter((row) => !attrsByRow.get(row.id)?.storeListingId)
        .map((row) => row.created_by)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [storesResult, sellersResult, ownsStoreResult] = await Promise.all([
    storeIds.length > 0
      ? supabase
          .from("listings")
          // store_verified es el espejo público de Presencia Verificada (0039);
          // store_active, el de la membresía de tienda (0048). Los dos viven en
          // el propio aviso de la tienda y son visibles para cualquiera — por
          // eso el Marketplace puede decidir con UN select y sin tocar
          // store_memberships, que la RLS le esconde al visitante.
          .select("id, title, store_verified, store_active, created_by")
          .eq("tenant_id", tenant.id)
          .eq("kind", "business")
          .in("id", storeIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            title: string;
            store_verified: boolean;
            store_active: boolean;
            created_by: string | null;
          }[],
        }),
    privateOwnerIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, display_name, identity_verified")
          .in("id", privateOwnerIds)
      : Promise.resolve({
          data: [] as { id: string; display_name: string | null; identity_verified: boolean }[],
        }),
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

  // Identidad de quien ADMINISTRA cada tienda (para el badge de identidad de
  // SellerChip, distinto del plan pago). Un batch aparte: los dueños de
  // tienda no tienen por qué solaparse con los `privateOwnerIds` de arriba.
  const storeOwnerIds = [
    ...new Set(
      (storesResult.data ?? [])
        .map((store) => store.created_by)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const storeOwnersResult =
    storeOwnerIds.length > 0
      ? await supabase.from("profiles").select("id, identity_verified").in("id", storeOwnerIds)
      : { data: [] as { id: string; identity_verified: boolean }[] };
  const identityByStoreOwner = new Map(
    (storeOwnersResult.data ?? []).map((profile) => [profile.id, profile.identity_verified]),
  );

  const storeById = new Map(
    (storesResult.data ?? []).map((store) => [
      store.id,
      {
        name: store.title,
        verified: store.store_verified,
        active: store.store_active,
        identityVerified: store.created_by
          ? (identityByStoreOwner.get(store.created_by) ?? false)
          : false,
      },
    ]),
  );
  const sellerById = new Map((sellersResult.data ?? []).map((profile) => [profile.id, profile]));
  const ownsStore = (ownsStoreResult.count ?? 0) > 0;

  // MEMBRESÍA VENCIDA ⇒ la tienda y sus productos salen de la vidriera (§7).
  //
  // El filtro se aplica ACÁ y no en la query principal a propósito: `listings`
  // no sabe a qué tienda pertenece un producto (la relación vive en
  // `attrs.store_listing_id`, un jsonb), así que no hay join que hacer en el
  // where. Se descarta después de resolver el lote de tiendas — el mismo que ya
  // se pedía para el nombre y el sello de verificada, sin una vuelta extra.
  //
  // Un producto de PARTICULAR nunca se filtra: no tiene tienda detrás y la
  // membresía no lo alcanza.
  const visibleRows = pageRows.filter((row) => {
    const storeId = attrsByRow.get(row.id)?.storeListingId;
    if (!storeId) return true;
    const store = storeById.get(storeId);
    // Tienda que no se pudo leer ⇒ no se muestra: preferimos una vidriera con
    // menos productos antes que una que muestra los de una tienda apagada.
    return store?.active === true;
  });

  const cards: ProductCardModel[] = visibleRows.map((row) => {
    const attrs = attrsByRow.get(row.id) ?? parseProductAttrs(row.attrs);
    const store = attrs.storeListingId ? storeById.get(attrs.storeListingId) : undefined;
    const seller = row.created_by ? sellerById.get(row.created_by) : undefined;
    return {
      id: row.id,
      title: row.title,
      priceLabel: formatProductPrice(row.price_amount, row.price_currency, tenant.locale),
      category: attrs.category,
      photoUrl: firstPhotoUrl(row.photos),
      // Todas las fotos ya resueltas: tocar la foto abre el visor con la
      // galería completa, sin entrar al detalle (feedback 2026-07-26).
      photos: allPhotoUrls(row.photos),
      seller: attrs.storeListingId
        ? {
            kind: "store",
            name: store?.name ?? null,
            storeId: attrs.storeListingId,
            verified: store?.verified ?? false,
            identityVerified: store?.identityVerified ?? false,
          }
        : {
            kind: "private",
            name: seller?.display_name ?? row.publisher_name ?? null,
            identityVerified: seller?.identity_verified ?? false,
          },
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextParams = new URLSearchParams();
  if (filters.categoria) nextParams.set("categoria", filters.categoria);
  if (filters.q) nextParams.set("q", filters.q);
  if (hasMore && lastRow) nextParams.set("cursor", encodeCursor(lastRow.created_at, lastRow.id));

  const isSearching = Boolean(filters.q);

  return (
    <>
      <MarketplaceTopBar tab="articulos" />

      {/* Bandeja de búsqueda: la caja ya no flota sobre la plancha, va contenida
          — es el "search de adentro de la categoría" del que habló el cliente. */}
      <Bubble tone="tray" shape="tile" size="none" className="mb-4 mt-4 p-3">
        <MarketplaceSearchBar />
      </Bubble>

      {ownsStore && <MarketplaceOwnerBanner />}

      <CategoryChips className={cn(ownsStore ? "mt-4" : "", "mb-5")} />

      {/* `cards.length === 0 && hasMore` es un caso real desde la membresía: una
          página entera puede quedar vacía porque todos sus productos eran de
          tiendas apagadas. Ahí NO va el estado vacío ("no hay productos" sería
          falso) — va el botón para seguir avanzando el cursor. */}
      {cards.length === 0 && !hasMore ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={
            isSearching
              ? C.emptySearchTitle(filters.q)
              : filters.categoria
                ? C.emptyFilteredTitle
                : C.emptyTitle
          }
          message={
            isSearching
              ? C.emptySearchMessage
              : filters.categoria
                ? C.emptyFilteredMessage
                : C.emptyMessage
          }
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
// Fallback de ARTÍCULOS: silueta del header + chips + grilla (shimmer, §5.2)
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <MarketplaceTopBar tab="articulos" />
      <Bubble tone="tray" shape="tile" size="none" className="mb-4 mt-4 p-3">
        <Skeleton className="h-11 w-full rounded-md" />
      </Bubble>
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

// ---------------------------------------------------------------------------
// TIENDAS (streamed): el directorio completo — antes sólo se llegaba a una
// tienda puntual desde el chip de vendedor de un producto (gap #1 de la spec).
// ---------------------------------------------------------------------------

async function MarketplaceStoresContent({ filters }: { filters: StoreFilters }) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // "Tu zona": el directorio de tiendas no tiene filtro de zona propio en la
  // URL, así que manda la preferencia (cookie › perfil). Una tienda es un
  // `kind='business'` nacido en /publicar, que sí pide la zona — a diferencia
  // de los artículos, ver la nota en `MarketplaceContent`.
  const vistaZona = await resolverVistaZona(tenant.id, null);

  let query = supabase
    .from("listings")
    .select(
      "id, title, area_label, attrs, photos, created_by, created_at, store_verified, store_active",
    )
    .eq("tenant_id", tenant.id)
    .eq("kind", "business")
    .eq("status", "published")
    // MEMBRESÍA VENCIDA ⇒ afuera del directorio, mismo criterio que la
    // vidriera individual (marketplace/tienda/[storeId]/page.tsx) y que el
    // filtro post-fetch que ya usa Artículos para sus productos.
    .eq("store_active", true)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (filters.q) {
    query = query.textSearch("search", filters.q, { type: "websearch", config: "spanish" });
  }
  if (vistaZona.areaLabels.length > 0) {
    query = query.in("area_label", vistaZona.areaLabels);
  }
  const cursor = decodeCursor(filters.cursor || undefined);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data: rows, error } = await query;
  if (error) {
    console.warn("[marketplace] query de tiendas falló", { code: error.code });
  }

  const pageRows = (rows ?? []).slice(0, PAGE_SIZE);
  const hasMore = (rows ?? []).length > PAGE_SIZE;
  const storeIds = pageRows.map((row) => row.id);
  const ownerIds = [
    ...new Set(pageRows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  ];

  // Cuatro lotes en paralelo, cada uno UNA sola consulta para TODAS las
  // tiendas de la página — nunca una consulta por tarjeta (la misma regla que
  // ya usaba Artículos para vendedores/tiendas, extendida acá):
  //  · identidad de quien administra cada tienda (badge de identidad, gratis);
  //  · a cuáles de estas tiendas sigue YA el viewer (botón Seguir);
  //  · calificaciones agregadas (listing_review_stats, 0093);
  //  · cantidad de artículos activos (ver src/lib/marketplace/store-directory.ts).
  const [ownersResult, followsResult, ratings, activeCounts] = await Promise.all([
    ownerIds.length > 0
      ? supabase.from("profiles").select("id, identity_verified").in("id", ownerIds)
      : Promise.resolve({ data: [] as { id: string; identity_verified: boolean }[] }),
    user && storeIds.length > 0
      ? supabase
          .from("follows")
          .select("target_id")
          .eq("tenant_id", tenant.id)
          .eq("follower_id", user.id)
          .eq("target_kind", "listing")
          .in("target_id", storeIds)
      : Promise.resolve({ data: [] as { target_id: string }[] }),
    fetchStoreRatings(supabase, storeIds),
    fetchActiveListingCounts(supabase, { tenantId: tenant.id, storeIds }),
  ]);

  const identityByOwner = new Map(
    (ownersResult.data ?? []).map((profile) => [profile.id, profile.identity_verified]),
  );
  const followingSet = new Set((followsResult.data ?? []).map((follow) => follow.target_id));

  const cards: StoreCardModel[] = pageRows.map((row) => {
    const attrs = parseProductAttrs(row.attrs);
    return {
      id: row.id,
      name: row.title,
      areaLabel: row.area_label,
      photoUrl: firstPhotoUrl(row.photos),
      photos: allPhotoUrls(row.photos),
      initialFollowing: followingSet.has(row.id),
      // El Trust Score del dueño no es parte de lo que pide la spec para esta
      // tarjeta (logo, nombre, categoría, ciudad, verificación, calificación,
      // artículos activos, Ver tienda, Seguir) — se omite acá para no sumar
      // otro batch de trust_scores a un directorio que puede tener muchas
      // filas; sí se muestra en la propia vidriera de la tienda.
      trust: null,
      verified: row.store_verified,
      identityVerified: row.created_by ? (identityByOwner.get(row.created_by) ?? false) : false,
      categoryLabel: businessCategoryDisplayLabel(attrs.category),
      rating: ratings.get(row.id) ?? { promedio: null, cantidad: 0 },
      activeListingCount: activeCounts.get(row.id) ?? 0,
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextParams = new URLSearchParams({ t: "tiendas" });
  if (filters.q) nextParams.set("q", filters.q);
  if (hasMore && lastRow) nextParams.set("cursor", encodeCursor(lastRow.created_at, lastRow.id));

  const isSearching = Boolean(filters.q);

  return (
    <>
      <MarketplaceTopBar tab="tiendas" />

      <Bubble tone="tray" shape="tile" size="none" className="mb-4 mt-4 p-3">
        <MarketplaceSearchBar label={CS.searchLabel} placeholder={CS.searchPlaceholder} />
      </Bubble>

      {/* A diferencia de Artículos, acá `cards.length === 0` sin más chequeo
          alcanza: `store_active` se filtra EN la query (no después, como el
          post-fetch de Artículos), así que `cards` siempre iguala 1:1 a
          `pageRows` — "vacío pero con más páginas" no puede pasar acá. */}
      {cards.length === 0 ? (
        // Vacío por "Tu zona" y sin búsqueda encima: se nombra la zona y se
        // ofrece volver a toda la comunidad en un toque.
        !isSearching && vistaZona.filtraPorPreferencia && vistaZona.zona.label ? (
          <ZonaVacia zona={vistaZona.zona.label} radioMillas={vistaZona.radioMillas} />
        ) : (
          <EmptyState
            illustration="/images/empty-state-search.png"
            title={isSearching ? CS.emptySearchTitle(filters.q) : CS.emptyTitle}
            message={isSearching ? CS.emptySearchMessage : CS.emptyMessage}
          />
        )
      ) : (
        <div className="flex flex-col gap-4">
          {cards.map((card) => (
            <StoreCard key={card.id} store={card} />
          ))}

          {hasMore && (
            <Link
              href={`/marketplace?${nextParams.toString()}`}
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
            >
              {CS.loadMore}
              <CaretDown size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Fallback de TIENDAS: silueta del header + tarjetas (shimmer, §5.2)
// ---------------------------------------------------------------------------

function StoresPageSkeleton() {
  return (
    <div aria-busy="true">
      <MarketplaceTopBar tab="tiendas" />
      <Bubble tone="tray" shape="tile" size="none" className="mb-4 mt-4 p-3">
        <Skeleton className="h-11 w-full rounded-md" />
      </Bubble>
      <StoreListSkeleton />
    </div>
  );
}
