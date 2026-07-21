import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants, EmptyState } from "@/components/ui";
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
  GigListSkeleton,
  parseGigAttrs,
  type GigCardModel,
} from "@/components/creators";
import { GigCard } from "@/components/creators/gig-card";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

export const metadata = { title: "Creadores" };

const PAGE_SIZE = 20;

export default async function CreadoresPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FeedContent />
    </Suspense>
  );
}

async function FeedContent() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  // Todos los avisos publicados, juntos (sin filtro por categoría): se muestran
  // todos los trabajos que buscan creadores.
  const { data: rows, error } = await supabase
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

      {gigs.length === 0 ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={COPY.feed.emptyTitle}
          message={COPY.feed.emptyMessage}
          action={
            <Link
              href="/creadores/publicar"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
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
