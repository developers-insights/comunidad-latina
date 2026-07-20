import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui";
import { EmptyState } from "@/components/ui";
import {
  buildTrustSignals,
  firstPhotoUrl,
  formatListingPrice,
  toTrustLevel,
  type PublisherView,
} from "@/components/listings";
import {
  COPY,
  CreatorsNav,
  GIG_CATEGORIES,
  GigCard,
  GigListSkeleton,
  gigCategoryMeta,
  isGigCategory,
  parseGigAttrs,
  type GigCardModel,
} from "@/components/creators";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

export const metadata = { title: "Creadores" };

const PAGE_SIZE = 20;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function CreadoresPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const cat = firstValue(sp.cat);
  return (
    <Suspense key={cat} fallback={<PageSkeleton />}>
      <FeedContent cat={isGigCategory(cat) ? cat : ""} />
    </Suspense>
  );
}

async function FeedContent({ cat }: { cat: string }) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  let query = supabase
    .from("listings")
    .select(
      "id, title, price_amount, price_currency, price_period, area_label, photos, attrs, created_by, publisher_name, created_at",
    )
    .eq("tenant_id", tenant.id)
    .eq("kind", "creator_gig")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);

  if (cat) query = query.eq("attrs->>category", cat);

  const { data: rows, error } = await query;
  if (error) console.warn("[creadores] query de gigs falló", { code: error.code });

  const gigRows = rows ?? [];
  const publisherIds = [
    ...new Set(gigRows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  ];

  const [profilesResult, trustResult] = await Promise.all([
    publisherIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, display_name, avatar_url, identity_verified")
          .in("id", publisherIds)
      : Promise.resolve({ data: [] as never[] }),
    publisherIds.length > 0
      ? supabase.from("trust_scores").select("profile_id, score, level, signals").in("profile_id", publisherIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const profileById = new Map((profilesResult.data ?? []).map((p) => [p.id, p]));
  const trustById = new Map((trustResult.data ?? []).map((t) => [t.profile_id, t]));

  const gigs: GigCardModel[] = gigRows.map((row) => {
    const attrs = parseGigAttrs(row.attrs);
    let publisher: PublisherView = null;
    if (row.created_by) {
      const profile = profileById.get(row.created_by);
      const trust = trustById.get(row.created_by);
      publisher = {
        type: "member",
        profileId: row.created_by,
        displayName: profile?.display_name ?? "Miembro de la comunidad",
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
      budgetLabel: formatListingPrice(row.price_amount, row.price_currency, row.price_period, tenant.locale),
      areaLabel: row.area_label,
      photoUrl: firstPhotoUrl(row.photos),
      category: attrs.category,
      urgent: attrs.urgent,
      publisher,
    };
  });

  return (
    <>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {COPY.feed.title}
          </h1>
          <p className="mt-0.5 text-sm text-foreground-secondary">{COPY.feed.subtitle}</p>
        </div>
        <Link
          href="/creadores/publicar"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
        >
          <Plus size={16} aria-hidden="true" />
          {COPY.feed.publishCta}
        </Link>
      </header>

      <CreatorsNav active="gigs" />

      {/* Filtro por categoría — chips scrollables */}
      <div className="mb-5 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <CategoryChip href="/creadores" label="Todos" active={!cat} />
        {GIG_CATEGORIES.map((category) => {
          const Icon = category.Icon;
          return (
            <CategoryChip
              key={category.id}
              href={`/creadores?cat=${encodeURIComponent(category.id)}`}
              label={category.label}
              icon={<Icon size={14} weight="fill" aria-hidden="true" />}
              active={cat === category.id}
            />
          );
        })}
      </div>

      {gigs.length === 0 ? (
        <EmptyState
          icon={cat ? gigCategoryMetaIcon(cat) : undefined}
          illustration={cat ? undefined : "/images/empty-state-search.png"}
          title={COPY.feed.emptyTitle}
          message={COPY.feed.emptyMessage}
          action={
            <Link href="/creadores/publicar" className={buttonVariants({ variant: "primary", size: "md" })}>
              <Plus size={18} aria-hidden="true" />
              {COPY.feed.emptyCta}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {gigs.map((gig) => (
            <GigCard key={gig.id} gig={gig} />
          ))}
        </div>
      )}
    </>
  );
}

function gigCategoryMetaIcon(cat: string) {
  const Icon = gigCategoryMeta(cat).Icon;
  return <Icon />;
}

function CategoryChip({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        // Filtro = chrome, no contenido: se esconde al imprimir (el activo usa
        // text-brand-foreground sobre bg-brand, que en papel no imprime su fondo).
        "cl-print-hide inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold",
        "transition-colors duration-(--duration-fast)",
        active
          ? "bg-brand text-brand-foreground"
          : "border border-border bg-surface text-foreground-secondary hover:border-border-strong",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <header className="mb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.feed.title}
        </h1>
        <p className="mt-0.5 text-sm text-foreground-secondary">{COPY.feed.subtitle}</p>
      </header>
      <CreatorsNav active="gigs" />
      <div className="mt-5">
        <GigListSkeleton />
      </div>
    </div>
  );
}
