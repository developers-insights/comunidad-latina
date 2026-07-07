import { Suspense } from "react";
import Link from "next/link";
import { CaretDown, Plus } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, Skeleton, buttonVariants } from "@/components/ui";
import {
  AlertButton,
  COPY,
  ListingCard,
  ListingFilters,
  ListingListSkeleton,
  buildTrustSignals,
  decodeCursor,
  encodeCursor,
  firstPhotoUrl,
  formatListingPrice,
  toTrustLevel,
  type ListingCardModel,
  type PublisherView,
  type VerificationView,
} from "@/components/listings";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Vivienda" };

const PAGE_SIZE = 10;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Filters {
  q: string;
  precio: number | null;
  hab: number | null;
  zona: string;
  cursor: string;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const precioRaw = Number(firstValue(sp.precio));
  const habRaw = Number(firstValue(sp.hab));
  return {
    q: firstValue(sp.q).slice(0, 120),
    precio: Number.isFinite(precioRaw) && precioRaw > 0 ? precioRaw : null,
    hab: Number.isFinite(habRaw) && habRaw >= 1 && habRaw <= 10 ? habRaw : null,
    zona: firstValue(sp.zona).slice(0, 80),
    cursor: firstValue(sp.cursor),
  };
}

export default async function PropiedadesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  return (
    <Suspense key={JSON.stringify(filters)} fallback={<PageSkeleton />}>
      <PropiedadesContent filters={filters} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed): datos reales con RLS del usuario
// ---------------------------------------------------------------------------

async function PropiedadesContent({ filters }: { filters: Filters }) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Área del usuario para el header de sección (si tiene perfil con zona).
  let userArea: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("area_label")
      .eq("id", user.id)
      .maybeSingle();
    userArea = profile?.area_label ?? null;
  }

  // -------------------------------------------------------------------------
  // Query principal: keyset pagination (created_at,id), filtros por searchParams
  // -------------------------------------------------------------------------
  let query = supabase
    .from("listings")
    .select(
      "id, title, price_amount, price_currency, price_period, area_label, photos, attrs, created_by, publisher_name, source, created_at",
    )
    .eq("tenant_id", tenant.id)
    .eq("kind", "property")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (filters.q) {
    query = query.textSearch("search", filters.q, { type: "websearch", config: "spanish" });
  }
  if (filters.precio !== null) {
    query = query.lte("price_amount", filters.precio);
  }
  if (filters.hab !== null) {
    query = query.gte("attrs->bedrooms", filters.hab);
  }
  if (filters.zona) {
    query = query.eq("area_label", filters.zona);
  }
  const cursor = decodeCursor(filters.cursor || undefined);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data: rows, error } = await query;

  if (error) {
    console.warn("[vivienda] query de listings falló", { code: error.code });
  }

  const pageRows = (rows ?? []).slice(0, PAGE_SIZE);
  const hasMore = (rows ?? []).length > PAGE_SIZE;

  // -------------------------------------------------------------------------
  // Batch 1: verificaciones found_active de estos listings (regla estricta)
  // Batch 2: perfiles + trust scores de los publicadores con cuenta
  // Batch 3: zonas disponibles para el filtro
  // -------------------------------------------------------------------------
  const listingIds = pageRows.map((row) => row.id);
  const publisherIds = [
    ...new Set(pageRows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  ];

  const [checksResult, profilesResult, trustResult, zonesResult] = await Promise.all([
    listingIds.length > 0
      ? supabase
          .from("verification_checks")
          .select("subject_id, registry, registry_url, license_number, checked_at")
          .eq("tenant_id", tenant.id)
          .eq("subject_kind", "listing")
          .eq("result", "found_active")
          .in("subject_id", listingIds)
          .order("checked_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    publisherIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, display_name, avatar_url, identity_verified")
          .in("id", publisherIds)
      : Promise.resolve({ data: [] as never[] }),
    publisherIds.length > 0
      ? supabase
          .from("trust_scores")
          .select("profile_id, score, level, signals")
          .in("profile_id", publisherIds)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("listings")
      .select("area_label")
      .eq("tenant_id", tenant.id)
      .eq("kind", "property")
      .eq("status", "published")
      .not("area_label", "is", null)
      .limit(200),
  ]);

  const verificationByListing = new Map<string, VerificationView>();
  for (const check of checksResult.data ?? []) {
    if (check.subject_id && !verificationByListing.has(check.subject_id)) {
      verificationByListing.set(check.subject_id, {
        registry: check.registry,
        registryUrl: check.registry_url,
        licenseNumber: check.license_number,
        dateLabel: formatDate(check.checked_at, { locale: tenant.locale, style: "long" }),
      });
    }
  }

  const profileById = new Map((profilesResult.data ?? []).map((p) => [p.id, p]));
  const trustById = new Map((trustResult.data ?? []).map((t) => [t.profile_id, t]));

  const zones = [
    ...new Set(
      (zonesResult.data ?? [])
        .map((row) => row.area_label)
        .filter((label): label is string => Boolean(label)),
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));

  const cards: ListingCardModel[] = pageRows.map((row) => {
    let publisher: PublisherView = null;
    if (row.created_by) {
      const profile = profileById.get(row.created_by);
      const trust = trustById.get(row.created_by);
      publisher = {
        type: "member",
        profileId: row.created_by,
        displayName: profile?.display_name ?? COPY.list.communityMember,
        avatarUrl: profile?.avatar_url ?? null,
        score: trust?.score ?? 0,
        level: toTrustLevel(trust?.level),
        signals: buildTrustSignals(trust?.signals ?? {}, profile?.identity_verified ?? false),
      };
    } else if (row.publisher_name) {
      publisher = { type: "external", name: row.publisher_name };
    }

    return {
      id: row.id,
      title: row.title,
      priceLabel: formatListingPrice(
        row.price_amount,
        row.price_currency,
        row.price_period,
        tenant.locale,
      ),
      areaLabel: row.area_label,
      photoUrl: firstPhotoUrl(row.photos),
      verification: verificationByListing.get(row.id) ?? null,
      publisher,
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextParams = new URLSearchParams();
  if (filters.q) nextParams.set("q", filters.q);
  if (filters.precio !== null) nextParams.set("precio", String(filters.precio));
  if (filters.hab !== null) nextParams.set("hab", String(filters.hab));
  if (filters.zona) nextParams.set("zona", filters.zona);
  if (hasMore && lastRow) nextParams.set("cursor", encodeCursor(lastRow.created_at, lastRow.id));

  const isSearching = Boolean(filters.q);

  return (
    <>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {COPY.list.title}
          </h1>
          <p className="mt-0.5 text-sm text-foreground-secondary">
            {userArea ? COPY.list.subtitleNearArea(userArea) : COPY.list.subtitleDefault}
          </p>
        </div>
        <Link
          href="/publicar"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
        >
          <Plus size={16} aria-hidden="true" />
          {COPY.list.publishCta}
        </Link>
      </header>

      <ListingFilters zones={zones} className="mb-5" />

      {cards.length === 0 ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={isSearching ? COPY.list.emptySearchTitle : COPY.list.emptyTitle}
          message={isSearching ? COPY.list.emptySearchMessage : COPY.list.emptyMessage}
          action={<AlertButton />}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {cards.map((card) => (
            <ListingCard key={card.id} listing={card} />
          ))}

          {hasMore && (
            <Link
              href={`/propiedades?${nextParams.toString()}`}
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
            >
              {COPY.list.loadMore}
              <CaretDown size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Fallback: silueta del header + filtros + cards (shimmer, §5.2)
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {COPY.list.title}
          </h1>
          <Skeleton className="mt-1.5 h-4 w-32" />
        </div>
        <Skeleton className="h-10 w-24 rounded-md" />
      </header>
      <div className="mb-5 flex flex-col gap-3">
        <Skeleton className="h-11 w-full rounded-md" />
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-11 rounded-md" />
          <Skeleton className="h-11 rounded-md" />
          <Skeleton className="h-11 rounded-md" />
        </div>
      </div>
      <ListingListSkeleton />
    </div>
  );
}
