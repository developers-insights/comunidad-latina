import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ClockCountdown,
  Lightning,
  MapPin,
  Package,
  Storefront,
} from "@phosphor-icons/react/dist/ssr";
import { z } from "zod";
import { Avatar, BezelCard, CardMedia, buttonVariants } from "@/components/ui";
import { IdentityBadge } from "@/components/auth/identity-badge";
import {
  PublisherTrust,
  buildTrustSignals,
  firstNameOf,
  firstPhotoUrl,
  formatListingPrice,
  toTrustLevel,
} from "@/components/listings";
import {
  ApplicationRow,
  ApplySheet,
  COPY,
  WithdrawButton,
  dollarsToCents,
  gigCategoryMeta,
  parseGigAttrs,
  type ApplicationCreator,
} from "@/components/creators";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

export const metadata = { title: "Trabajo" };

export default async function GigDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: gig } = await supabase
    .from("listings")
    .select(
      "id, tenant_id, kind, title, description, price_amount, price_currency, price_period, area_label, photos, attrs, status, created_by, publisher_name",
    )
    .eq("id", id)
    .maybeSingle();

  if (!gig || gig.kind !== "creator_gig") notFound();

  const isOwner = Boolean(user && gig.created_by === user.id);
  if (gig.status !== "published" && !isOwner) notFound();

  const attrs = parseGigAttrs(gig.attrs);
  const category = gigCategoryMeta(attrs.category);
  const CategoryIcon = category.Icon;
  const budgetLabel = formatListingPrice(
    gig.price_amount,
    gig.price_currency,
    gig.price_period,
    tenant.locale,
  );

  // Publicador (el negocio) con Trust Score.
  let publisherBlock: React.ReactNode = null;
  if (gig.created_by) {
    const [{ data: profile }, { data: trust }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, avatar_url, identity_verified").eq("id", gig.created_by).maybeSingle(),
      supabase.from("trust_scores").select("score, level, signals").eq("profile_id", gig.created_by).maybeSingle(),
    ]);
    const name = profile?.display_name ?? "Negocio de la comunidad";
    publisherBlock = (
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3">
        <Avatar
          size="md"
          src={profile?.avatar_url ?? null}
          name={name}
          badge={profile?.identity_verified ? <IdentityBadge /> : undefined}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{name}</p>
          <PublisherTrust
            displayName={name}
            firstName={firstNameOf(name)}
            score={trust?.score ?? 0}
            level={toTrustLevel(trust?.level)}
            signals={buildTrustSignals(trust?.signals ?? {}, profile?.identity_verified ?? false)}
            size="inline"
          />
        </div>
      </div>
    );
  } else if (gig.publisher_name) {
    publisherBlock = (
      <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface p-3 text-sm text-foreground-secondary">
        <Storefront size={18} aria-hidden="true" />
        {gig.publisher_name}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-4">
      <Link
        href="/creadores"
        className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {COPY.gig.backToFeed}
      </Link>

      {/* Hero */}
      <div className="overflow-hidden rounded-xl">
        {gig.photos && gig.photos.length > 0 ? (
          <CardMedia
            src={firstPhotoUrl(gig.photos)}
            fallbackSrc="/images/hero-vivienda.png"
            aspect="video"
            overlayTopLeft={
              <span className="inline-flex items-center gap-1 rounded-full cl-print-fill bg-media-scrim px-2.5 py-1 text-xs font-semibold text-on-media backdrop-blur-sm">
                <CategoryIcon size={13} weight="fill" aria-hidden="true" />
                {category.label}
              </span>
            }
            overlayTopRight={
              attrs.urgent ? (
                <span className="inline-flex items-center gap-1 rounded-full cl-print-fill bg-media-scrim px-2.5 py-1 text-xs font-bold text-on-media backdrop-blur-sm">
                  <Lightning size={13} weight="fill" aria-hidden="true" />
                  {COPY.feed.urgentChip}
                </span>
              ) : null
            }
          />
        ) : (
          <div
            className="relative flex aspect-video w-full items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in oklab, var(--accent-creadores) 78%, black), var(--accent-creadores))",
            }}
          >
            <CategoryIcon size={72} weight="fill" aria-hidden="true" className="text-on-media/85" />
            <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full cl-print-fill bg-media-scrim px-2.5 py-1 text-xs font-semibold text-on-media backdrop-blur-sm">
              <CategoryIcon size={13} weight="fill" aria-hidden="true" />
              {category.label}
            </span>
            {attrs.urgent && (
              <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full cl-print-fill bg-media-scrim px-2.5 py-1 text-xs font-bold text-on-media backdrop-blur-sm">
                <Lightning size={13} weight="fill" aria-hidden="true" />
                {COPY.feed.urgentChip}
              </span>
            )}
          </div>
        )}
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-foreground">
          {gig.title}
        </h1>
        {gig.area_label && (
          <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
            <MapPin size={16} aria-hidden="true" />
            {gig.area_label}
          </p>
        )}
      </header>

      {/* Presupuesto */}
      <BezelCard variant="featured" coreClassName="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs font-medium text-foreground-secondary">{COPY.gig.aboutBudget}</p>
          {budgetLabel && <p className="numeric text-3xl font-bold text-brand">{budgetLabel}</p>}
        </div>
        {attrs.deadlineDays !== null && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground-secondary">
            <ClockCountdown size={18} aria-hidden="true" />
            {COPY.gig.deadlineLabel(attrs.deadlineDays)}
          </p>
        )}
      </BezelCard>

      {attrs.deliverables && (
        <section className="flex flex-col gap-1.5">
          <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-foreground">
            <Package size={18} weight="fill" aria-hidden="true" className="text-brand" />
            {COPY.gig.deliverablesTitle}
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
            {attrs.deliverables}
          </p>
        </section>
      )}

      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{gig.description}</p>

      {publisherBlock && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-foreground">{COPY.gig.aboutBusiness}</h2>
          {publisherBlock}
        </section>
      )}

      {/* Zona de acción */}
      {isOwner ? (
        <OwnerApplications
          gigId={gig.id}
          gigTitle={gig.title}
          gigBudgetCents={dollarsToCents(gig.price_amount ?? 0)}
          isPending={gig.status !== "published"}
        />
      ) : (
        <ApplicantAction gigId={gig.id} userId={user?.id ?? null} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Acción del creador (aplicar / ya aplicó / retirar) o invitación a entrar
// ---------------------------------------------------------------------------

async function ApplicantAction({ gigId, userId }: { gigId: string; userId: string | null }) {
  if (!userId) {
    return (
      <Link
        href={`/entrar?next=${encodeURIComponent(`/creadores/${gigId}`)}`}
        className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
      >
        {COPY.apply.title}
      </Link>
    );
  }

  const supabase = await createClient();
  const { data: application } = await supabase
    .from("gig_applications")
    .select("id, status")
    .eq("gig_id", gigId)
    .eq("creator_id", userId)
    .maybeSingle();

  if (!application || application.status === "withdrawn" || application.status === "declined") {
    return <ApplySheet gigId={gigId} />;
  }

  return (
    <BezelCard variant="success" coreClassName="flex flex-col items-center gap-2 px-6 py-6 text-center" role="status">
      <p className="font-display text-lg font-semibold text-foreground">{COPY.gig.alreadyApplied}</p>
      <p className="max-w-[40ch] text-sm text-foreground-secondary">{COPY.gig.alreadyAppliedBody}</p>
      {application.status === "submitted" && (
        <div className="mt-1">
          <WithdrawButton applicationId={application.id} />
        </div>
      )}
    </BezelCard>
  );
}

// ---------------------------------------------------------------------------
// Vista del dueño: propuestas recibidas con el perfil resumido del creador
// ---------------------------------------------------------------------------

async function OwnerApplications({
  gigId,
  gigTitle,
  gigBudgetCents,
  isPending,
}: {
  gigId: string;
  gigTitle: string;
  gigBudgetCents: number;
  isPending: boolean;
}) {
  const supabase = await createClient();
  const { data: applications } = await supabase
    .from("gig_applications")
    .select("id, creator_id, message, proposed_amount_cents, status")
    .eq("gig_id", gigId)
    .order("created_at", { ascending: false });

  const rows = applications ?? [];
  const creatorIds = [...new Set(rows.map((row) => row.creator_id))];

  const [{ data: profiles }, { data: trusts }, { data: creatorProfiles }] = await Promise.all([
    creatorIds.length
      ? supabase.from("profiles").select("id, display_name, avatar_url, identity_verified").in("id", creatorIds)
      : Promise.resolve({ data: [] as never[] }),
    creatorIds.length
      ? supabase.from("trust_scores").select("profile_id, score, level, signals").in("profile_id", creatorIds)
      : Promise.resolve({ data: [] as never[] }),
    creatorIds.length
      ? supabase
          .from("creator_profiles")
          .select("profile_id, headline, rating_avg, rating_count, completed_jobs")
          .in("profile_id", creatorIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const trustById = new Map((trusts ?? []).map((t) => [t.profile_id, t]));
  const creatorById = new Map((creatorProfiles ?? []).map((c) => [c.profile_id, c]));

  return (
    <section className="flex flex-col gap-3">
      {isPending && (
        <BezelCard coreClassName="flex flex-col gap-1.5 p-4">
          <p className="text-sm leading-relaxed text-foreground-secondary">{COPY.gig.pendingReviewOwner}</p>
        </BezelCard>
      )}

      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-foreground">{COPY.applications.title}</h2>
        {rows.length > 0 && (
          <span className="text-sm font-medium text-foreground-secondary">
            {COPY.feed.proposalsCount(rows.length)}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center text-sm text-foreground-muted">
          {COPY.applications.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const profile = profileById.get(row.creator_id);
            const trust = trustById.get(row.creator_id);
            const cp = creatorById.get(row.creator_id);
            const name = profile?.display_name ?? "Creador de la comunidad";
            const creator: ApplicationCreator = {
              profileId: row.creator_id,
              displayName: name,
              avatarUrl: profile?.avatar_url ?? null,
              identityVerified: profile?.identity_verified ?? false,
              headline: cp?.headline ?? null,
              ratingAvg: cp?.rating_avg ?? null,
              ratingCount: cp?.rating_count ?? 0,
              completedJobs: cp?.completed_jobs ?? 0,
              score: trust?.score ?? 0,
              level: toTrustLevel(trust?.level),
              signals: buildTrustSignals(trust?.signals ?? {}, profile?.identity_verified ?? false),
            };
            return (
              <ApplicationRow
                key={row.id}
                application={{
                  id: row.id,
                  status: row.status,
                  message: row.message,
                  proposedAmountCents: row.proposed_amount_cents,
                }}
                creator={creator}
                gigTitle={gigTitle}
                gigBudgetCents={gigBudgetCents}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
