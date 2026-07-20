import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle, MapPin, Star, UserCircle } from "@phosphor-icons/react/dist/ssr";
import { z } from "zod";
import { Avatar, EmptyState, buttonVariants } from "@/components/ui";
import { IdentityBadge } from "@/components/auth/identity-badge";
import { FollowButton } from "@/components/social/follow-button";
import {
  PublisherTrust,
  buildTrustSignals,
  firstNameOf,
  toTrustLevel,
} from "@/components/listings";
import { COPY, ContractForm, RatingStars, creatorPhotoUrl } from "@/components/creators";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Perfil de creador" };

export default async function CreadorPublicoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Mi propio perfil se edita en /creadores/perfil.
  if (user?.id === id) redirect("/creadores/perfil");

  const [{ data: creator }, { data: profile }, { data: trust }, { data: reviews }] = await Promise.all([
    supabase
      .from("creator_profiles")
      .select("profile_id, headline, bio, skills, portfolio_photos, rate_hint, available, completed_jobs, rating_avg, rating_count")
      .eq("profile_id", id)
      .maybeSingle(),
    supabase.from("profiles").select("id, display_name, avatar_url, identity_verified, area_label").eq("id", id).maybeSingle(),
    supabase.from("trust_scores").select("score, level, signals").eq("profile_id", id).maybeSingle(),
    supabase
      .from("gig_reviews")
      .select("id, reviewer_id, rating, body, created_at")
      .eq("ratee_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (!creator) {
    if (!user) {
      return (
        <EmptyState
          icon={<UserCircle />}
          title={COPY.profile.notFoundTitle}
          message={COPY.profile.notFoundBody}
          action={
            <Link
              href={`/entrar?next=${encodeURIComponent(`/creadores/perfil/${id}`)}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {COPY.profile.needLoginCta}
            </Link>
          }
        />
      );
    }
    notFound();
  }

  const displayName = profile?.display_name ?? "Creador de la comunidad";
  const score = trust?.score ?? 0;
  const level = toTrustLevel(trust?.level);
  const signals = buildTrustSignals(trust?.signals ?? {}, profile?.identity_verified ?? false);

  // Nombres de quienes reseñaron (perfiles requieren sesión — anon degrada).
  const reviewerIds = [...new Set((reviews ?? []).map((r) => r.reviewer_id))];
  const { data: reviewers } = reviewerIds.length
    ? await supabase.from("profiles").select("id, display_name, avatar_url").in("id", reviewerIds)
    : { data: [] as { id: string; display_name: string; avatar_url: string | null }[] };
  const reviewerById = new Map((reviewers ?? []).map((r) => [r.id, r]));

  const { data: existingFollow } = user
    ? await supabase
        .from("follows")
        .select("target_id")
        .eq("follower_id", user.id)
        .eq("target_kind", "profile")
        .eq("target_id", id)
        .maybeSingle()
    : { data: null };

  const portfolio = creator.portfolio_photos ?? [];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col items-center gap-3 text-center">
        <Avatar
          size="xl"
          src={profile?.avatar_url ?? null}
          name={displayName}
          badge={profile?.identity_verified ? <IdentityBadge /> : undefined}
        />
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-xl font-bold text-foreground">{displayName}</h1>
          <p className="text-sm text-foreground-secondary">{creator.headline}</p>
          {profile?.area_label && (
            <p className="flex items-center justify-center gap-1 text-sm text-foreground-muted">
              <MapPin size={14} aria-hidden="true" />
              {profile.area_label}
            </p>
          )}
        </div>
        <FollowButton targetKind="profile" targetId={id} initialFollowing={Boolean(existingFollow)} size="sm" />
      </section>

      {/* Reputación — el "score de crédito": estrellas + trabajos + Trust Score */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <RatingStars avg={creator.rating_avg} count={creator.rating_count} size={16} />
          {creator.completed_jobs > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground-secondary">
              <CheckCircle size={16} weight="fill" aria-hidden="true" className="text-success" />
              {COPY.directory.completedJobs(creator.completed_jobs)}
            </span>
          )}
        </div>
        <PublisherTrust
          displayName={displayName}
          firstName={firstNameOf(displayName)}
          score={score}
          level={level}
          signals={signals}
          size="card"
        />
      </section>

      {/* CTA: proponer un trabajo directo (contrato con gig_id null) */}
      {user ? (
        <div className="flex flex-col gap-1.5">
          <ContractForm
            creatorId={id}
            creatorName={displayName}
            triggerLabel={COPY.profile.proposeCta}
            triggerSize="lg"
            triggerClassName="w-full"
          />
          <p className="text-center text-xs text-foreground-muted">{COPY.profile.hireHint}</p>
        </div>
      ) : (
        <Link
          href={`/entrar?next=${encodeURIComponent(`/creadores/perfil/${id}`)}`}
          className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
        >
          {COPY.profile.proposeCta}
        </Link>
      )}

      {creator.bio && (
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">{creator.bio}</p>
      )}

      {creator.skills && creator.skills.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-foreground">{COPY.profile.skillsTitle}</h2>
          <ul className="flex flex-wrap gap-1.5">
            {creator.skills.map((skill) => (
              <li
                key={skill}
                className="rounded-full bg-surface-subtle px-3 py-1 text-sm font-medium text-foreground-secondary"
              >
                {skill}
              </li>
            ))}
          </ul>
        </section>
      )}

      {portfolio.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-foreground">{COPY.profile.portfolioTitle}</h2>
          <div className="grid grid-cols-2 gap-2">
            {portfolio.map((path, index) => (
              <div key={path} className="aspect-square overflow-hidden rounded-lg bg-surface-subtle">
                {/* eslint-disable-next-line @next/next/no-img-element -- fotos públicas del bucket post-media */}
                <img
                  src={creatorPhotoUrl(path)}
                  alt={`Trabajo ${index + 1} de ${displayName}`}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-base font-bold text-foreground">{COPY.profile.reviewsTitle}</h2>
        {reviews && reviews.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {reviews.map((review) => {
              const reviewer = reviewerById.get(review.reviewer_id);
              return (
                <li key={review.id} className="rounded-lg border border-border-subtle bg-surface p-4">
                  <div className="flex items-center gap-2.5">
                    <Avatar size="sm" src={reviewer?.avatar_url ?? null} name={reviewer?.display_name ?? "Alguien"} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {reviewer?.display_name ?? "Alguien de la comunidad"}
                      </p>
                      <span aria-hidden="true" className="flex">
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star
                            key={i}
                            size={13}
                            weight={i < review.rating ? "fill" : "regular"}
                            className={i < review.rating ? "text-warning" : "text-border"}
                          />
                        ))}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-foreground-muted">
                      {formatDate(review.created_at, { locale: tenant.locale, style: "medium" })}
                    </span>
                  </div>
                  {review.body && (
                    <p className="mt-2.5 whitespace-pre-line text-sm text-foreground-secondary">{review.body}</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center text-sm text-foreground-muted">
            {COPY.profile.noReviews}
          </p>
        )}
      </section>
    </div>
  );
}
