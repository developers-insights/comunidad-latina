import { Suspense } from "react";
import Link from "next/link";
import { UserCirclePlus } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { firstPortfolioUrl } from "@/components/creators";
import {
  COPY,
  CreatorCard,
  CreatorListSkeleton,
  CreatorsNav,
  type CreatorCardModel,
} from "@/components/creators";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

export const metadata = { title: "Buscar creadores" };

const PAGE_SIZE = 30;

export default function BuscarCreadoresPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DirectoryContent />
    </Suspense>
  );
}

async function DirectoryContent() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rows, error } = await supabase
    .from("creator_profiles")
    .select(
      "profile_id, headline, skills, portfolio_photos, available, completed_jobs, rating_avg, rating_count",
    )
    .eq("tenant_id", tenant.id)
    .order("available", { ascending: false })
    .order("rating_avg", { ascending: false, nullsFirst: false })
    .order("completed_jobs", { ascending: false })
    .limit(PAGE_SIZE);

  if (error) console.warn("[creadores] directorio falló", { code: error.code });

  const profileRows = rows ?? [];
  const profileIds = profileRows.map((row) => row.profile_id);

  const [profilesResult, followsResult, myProfileResult] = await Promise.all([
    profileIds.length > 0
      ? supabase.from("profiles").select("id, display_name, avatar_url, identity_verified").in("id", profileIds)
      : Promise.resolve({ data: [] as never[] }),
    user && profileIds.length > 0
      ? supabase
          .from("follows")
          .select("target_id")
          .eq("follower_id", user.id)
          .eq("target_kind", "profile")
          .in("target_id", profileIds)
      : Promise.resolve({ data: [] as { target_id: string }[] }),
    user
      ? supabase.from("creator_profiles").select("profile_id").eq("profile_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const profileById = new Map((profilesResult.data ?? []).map((p) => [p.id, p]));
  const following = new Set((followsResult.data ?? []).map((f) => f.target_id));

  const creators: CreatorCardModel[] = profileRows.map((row) => {
    const profile = profileById.get(row.profile_id);
    return {
      profileId: row.profile_id,
      displayName: profile?.display_name ?? "Creador de la comunidad",
      avatarUrl: profile?.avatar_url ?? null,
      identityVerified: profile?.identity_verified ?? false,
      headline: row.headline,
      skills: row.skills ?? [],
      portfolioUrl: firstPortfolioUrl(row.portfolio_photos),
      ratingAvg: row.rating_avg,
      ratingCount: row.rating_count,
      completedJobs: row.completed_jobs,
      available: row.available,
      initialFollowing: following.has(row.profile_id),
    };
  });

  const hasMyProfile = Boolean(myProfileResult.data);

  return (
    <>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {COPY.directory.title}
          </h1>
          <p className="mt-0.5 text-sm text-foreground-secondary">{COPY.directory.subtitle}</p>
        </div>
        <Link
          href="/creadores/perfil"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
        >
          {hasMyProfile ? COPY.directory.editProfileCta : COPY.directory.createProfileCta}
        </Link>
      </header>

      <CreatorsNav active="creators" />

      {creators.length === 0 ? (
        <EmptyState
          icon={<UserCirclePlus />}
          title={COPY.directory.emptyTitle}
          message={COPY.directory.emptyMessage}
          action={
            <Link href="/creadores/perfil" className={buttonVariants({ variant: "primary", size: "md" })}>
              {COPY.directory.emptyCta}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {creators.map((creator) => (
            <CreatorCard key={creator.profileId} creator={creator} />
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
          {COPY.directory.title}
        </h1>
        <p className="mt-0.5 text-sm text-foreground-secondary">{COPY.directory.subtitle}</p>
      </header>
      <CreatorsNav active="creators" />
      <div className="mt-5">
        <CreatorListSkeleton />
      </div>
    </div>
  );
}
