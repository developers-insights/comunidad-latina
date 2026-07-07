import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, CaretDown, Plus, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, EmptyState, Skeleton, buttonVariants } from "@/components/ui";
import {
  buildTrustSignals,
  decodeCursor,
  encodeCursor,
  toTrustLevel,
  type PublisherView,
  type VerificationView,
} from "@/components/listings";
import {
  CategoryChips,
  COPY,
  ProfessionalCard,
  isProfessionalCategory,
  parseProfessionalAttrs,
  type ProfessionalCardModel,
} from "@/components/directory";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Profesionales" };

const PAGE_SIZE = 12;
const C = COPY.professionals;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Filters {
  rubro: string;
  cursor: string;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const rubroRaw = firstValue(sp.rubro).slice(0, 40);
  return {
    rubro: isProfessionalCategory(rubroRaw) ? rubroRaw : "",
    cursor: firstValue(sp.cursor),
  };
}

export default async function ProfesionalesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  return (
    <Suspense key={JSON.stringify(filters)} fallback={<PageSkeleton />}>
      <ProfesionalesContent filters={filters} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed): datos reales con RLS del usuario
// ---------------------------------------------------------------------------

async function ProfesionalesContent({ filters }: { filters: Filters }) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  // -------------------------------------------------------------------------
  // Query principal: keyset pagination (created_at,id), filtro por rubro
  // -------------------------------------------------------------------------
  let query = supabase
    .from("listings")
    .select("id, title, area_label, attrs, created_by, publisher_name, created_at")
    .eq("tenant_id", tenant.id)
    .eq("kind", "professional")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (filters.rubro) {
    query = query.eq("attrs->>category", filters.rubro);
  }
  const cursor = decodeCursor(filters.cursor || undefined);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data: rows, error } = await query;
  if (error) {
    console.warn("[directorios] query de profesionales falló", { code: error.code });
  }

  const pageRows = (rows ?? []).slice(0, PAGE_SIZE);
  const hasMore = (rows ?? []).length > PAGE_SIZE;

  // -------------------------------------------------------------------------
  // Batch: verificaciones found_active (regla estricta — misma que vivienda)
  //        + perfiles y trust scores de los publicadores con cuenta
  // -------------------------------------------------------------------------
  const listingIds = pageRows.map((row) => row.id);
  const publisherIds = [
    ...new Set(pageRows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  ];

  const [checksResult, profilesResult, trustResult] = await Promise.all([
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

  const cards: ProfessionalCardModel[] = pageRows.map((row) => {
    let publisher: PublisherView = null;
    if (row.created_by) {
      const profile = profileById.get(row.created_by);
      const trust = trustById.get(row.created_by);
      publisher = {
        type: "member",
        profileId: row.created_by,
        displayName: profile?.display_name ?? C.communityMember,
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
      category: parseProfessionalAttrs(row.attrs).category,
      areaLabel: row.area_label,
      verification: verificationByListing.get(row.id) ?? null,
      publisher,
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextParams = new URLSearchParams();
  if (filters.rubro) nextParams.set("rubro", filters.rubro);
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
          href="/publicar"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
        >
          <Plus size={16} aria-hidden="true" />
          {C.publishCta}
        </Link>
      </header>

      {/* Banner de verificación → el Escudo hace el resto */}
      <BezelCard variant="featured" className="mb-4" coreClassName="flex items-center gap-3 p-4">
        <SealCheck size={28} weight="fill" aria-hidden="true" className="shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold text-foreground">{C.verifyBannerLead}</p>
          <p className="mt-0.5 text-xs text-foreground-secondary">{C.verifyBannerBody}</p>
        </div>
        <Link
          href="/escudo/verificar"
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0")}
        >
          {C.verifyBannerCta}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </BezelCard>

      <CategoryChips className="mb-5" />

      {cards.length === 0 ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={filters.rubro ? C.emptyFilteredTitle : C.emptyTitle}
          message={filters.rubro ? C.emptyFilteredMessage : C.emptyMessage}
          action={
            <Link
              href="/publicar"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {C.publishCta}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {cards.map((card) => (
            <ProfessionalCard key={card.id} professional={card} />
          ))}

          {hasMore && (
            <Link
              href={`/profesionales?${nextParams.toString()}`}
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
// Fallback: silueta del header + banner + chips + cards (shimmer, §5.2)
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {C.title}
          </h1>
          <Skeleton className="mt-1.5 h-4 w-40" />
        </div>
        <Skeleton className="h-10 w-24 rounded-md" />
      </header>
      <Skeleton className="mb-4 h-20 w-full rounded-xl" />
      <div className="mb-5 flex gap-2">
        <Skeleton className="h-11 w-20 rounded-full" />
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-20 rounded-full" />
      </div>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-44 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
