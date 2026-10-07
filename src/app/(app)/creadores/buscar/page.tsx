import { Suspense } from "react";
import Link from "next/link";
import { UserCirclePlus } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { creatorPhotoUrl, firstPortfolioUrl } from "@/components/creators";
import {
  COPY,
  CreatorCard,
  CreatorListSkeleton,
  CreatorsNav,
  type CreatorCardModel,
} from "@/components/creators";
import { AdChip } from "@/components/feed/card-ad-chip";
import { separarPatrocinados } from "@/app/(app)/impulsar/perfil-creador/modelo";
import {
  leerPerfilesPatrocinados,
  registrarImpresionesDePerfil,
} from "@/app/(app)/impulsar/perfil-creador/patrocinados";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { leerChecksAzules } from "@/lib/verificacion/read";
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
  const userId = await getAuthUserId();

  const [{ data: rows, error }, patrocinados] = await Promise.all([
    supabase
      .from("creator_profiles")
      .select(
        "profile_id, status, headline, skills, portfolio_photos, available, completed_jobs, rating_avg, rating_count",
      )
      .eq("tenant_id", tenant.id)
      .order("available", { ascending: false })
      .order("rating_avg", { ascending: false, nullsFirst: false })
      .order("completed_jobs", { ascending: false })
      .limit(PAGE_SIZE),
    leerPerfilesPatrocinados(supabase, tenant.id),
  ]);

  if (error) console.warn("[creadores] directorio falló", { code: error.code });

  // Un patrocinado puede no entrar en la primera página orgánica: se trae su
  // fila aparte para que el lugar pago se cumpla igual.
  const organicos = rows ?? [];
  const idsOrganicos = new Set(organicos.map((row) => row.profile_id));
  const faltantes = patrocinados
    .map((p) => p.creatorId)
    .filter((id) => !idsOrganicos.has(id));
  const { data: filasFaltantes } =
    faltantes.length > 0
      ? await supabase
          .from("creator_profiles")
          .select(
            "profile_id, status, headline, skills, portfolio_photos, available, completed_jobs, rating_avg, rating_count",
          )
          .eq("tenant_id", tenant.id)
          .in("profile_id", faltantes)
      : { data: [] as typeof organicos };

  const profileRows = [...organicos, ...(filasFaltantes ?? [])];
  const profileIds = profileRows.map((row) => row.profile_id);
  // Sólo un creador aprobado ocupa el lugar pago: si lo suspendieron después de
  // pagar, vuelve a su lugar orgánico en vez de quedar arriba.
  const aprobados = new Set(
    profileRows.filter((row) => row.status === "approved").map((row) => row.profile_id),
  );
  const patrocinadosVigentes = patrocinados.filter((p) => aprobados.has(p.creatorId));

  const [profilesResult, followsResult, myProfileResult, checksAzules] = await Promise.all([
    profileIds.length > 0
      ? supabase.from("profiles").select("id, display_name, avatar_url, identity_verified").in("id", profileIds)
      : Promise.resolve({ data: [] as never[] }),
    userId && profileIds.length > 0
      ? supabase
          .from("follows")
          .select("target_id")
          .eq("follower_id", userId)
          .eq("target_kind", "profile")
          .in("target_id", profileIds)
      : Promise.resolve({ data: [] as { target_id: string }[] }),
    userId
      ? supabase.from("creator_profiles").select("profile_id").eq("profile_id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
    leerChecksAzules(supabase, profileIds),
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
      checkAzul: checksAzules.has(row.profile_id),
      headline: row.headline,
      skills: row.skills ?? [],
      portfolioUrl: firstPortfolioUrl(row.portfolio_photos),
      // Portfolio completo: tocar la foto abre el visor con todas, sin salir
      // del directorio (feedback 2026-07-26).
      portfolioPhotos: (row.portfolio_photos ?? [])
        .filter((photo) => photo && photo.trim().length > 0)
        .map(creatorPhotoUrl),
      ratingAvg: row.rating_avg,
      ratingCount: row.rating_count,
      completedJobs: row.completed_jobs,
      available: row.available,
      initialFollowing: following.has(row.profile_id),
      isSelf: userId ? row.profile_id === userId : false,
    };
  });

  const hasMyProfile = Boolean(myProfileResult.data);

  const { patrocinados: arriba, resto } = separarPatrocinados(
    creators.filter((c) => idsOrganicos.has(c.profileId) || aprobados.has(c.profileId)),
    patrocinadosVigentes.map((p) => p.creatorId),
  );
  const servidos = new Set(arriba.map((c) => c.profileId));
  await registrarImpresionesDePerfil(
    patrocinadosVigentes.filter((p) => servidos.has(p.creatorId)).map((p) => p.impulsoId),
  );

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
          {arriba.map((creator) => (
            <div key={creator.profileId} className="flex flex-col gap-2">
              <AdChip className="self-start" />
              <CreatorCard creator={creator} />
            </div>
          ))}
          {resto.map((creator) => (
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
