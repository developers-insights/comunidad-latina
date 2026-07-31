import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChatCircle, UserCircle } from "@phosphor-icons/react/dist/ssr";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { EmptyState, buttonVariants } from "@/components/ui";
import { TrustScoreCard } from "@/components/trust";
import { decodeCursor } from "@/components/listings";
import { MessageCta } from "@/components/auth/message-cta";
import { ProfileActionsMenu } from "@/components/auth/profile-actions-menu";
import { countryName } from "@/components/auth/countries";
import {
  normalizeTrustLevel,
  trustSignalsFrom,
} from "@/components/auth/trust-signals";
import { ProfileHeader } from "../profile-header";
import { ShareProfileButton } from "../share-profile-button";
import { ProfileTabSection } from "../profile-tab-section";
import { fetchProfileCounts } from "../profile-data";
import { memberSinceLabel, parseProfileTab, profileTabHref } from "../profile-tabs";

export const metadata = { title: "Perfil" };

const COPY = {
  sendMessage: "Enviar mensaje",
  loginTitle: "Este perfil es de la comunidad",
  loginMessage:
    "Entrá a tu cuenta para ver los perfiles y el Trust Score de tus vecinos.",
  loginCta: "Entrar",
  statPosts: "Publicaciones",
  statFollowers: "Seguidores",
  statFollowing: "Siguiendo",
  trustHeading: (name: string) => `Trust Score de ${name}`,
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function PerfilPublicoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [tenant, supabase, sp] = await Promise.all([
    getTenant(),
    createClient(),
    searchParams,
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Tu propio perfil vive en /perfil (con edición y cuenta).
  if (user?.id === id) redirect("/perfil");

  const [{ data: profile }, { data: trust }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("trust_scores").select("*").eq("profile_id", id).maybeSingle(),
  ]);

  if (!profile) {
    // RLS: sin sesión no se ven perfiles — guiamos, nunca un error seco.
    if (!user) {
      return (
        <EmptyState
          icon={<UserCircle />}
          title={COPY.loginTitle}
          message={COPY.loginMessage}
          action={
            <Link
              href={`/entrar?next=${encodeURIComponent(`/perfil/${id}`)}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {COPY.loginCta}
            </Link>
          }
        />
      );
    }
    notFound();
  }

  const cursor = decodeCursor(firstValue(sp.fotos) || undefined);
  const tab = parseProfileTab(firstValue(sp.t) || undefined);

  // Con perfil (⇒ hay sesión por RLS): conversación previa + los contadores.
  const [{ data: existingConversation }, counts] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, status, created_at")
      .or(`created_by.eq.${id},counterpart_id.eq.${id}`)
      .neq("status", "blocked")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    fetchProfileCounts(supabase, { tenantId: tenant.id, profileId: id }),
  ]);

  const score = trust?.score ?? 0;
  const level = normalizeTrustLevel(trust?.level, score);
  const signals = trustSignalsFrom(trust?.signals ?? null, profile.identity_verified);
  const firstName = profile.display_name.split(/\s+/)[0] ?? profile.display_name;
  const country = countryName(profile.country_origin);
  const location = [country, profile.area_label].filter(Boolean).join(" · ") || null;
  const base = `/perfil/${id}`;
  const memberSince = memberSinceLabel(profile.created_at, tenant.locale);

  return (
    <div className="flex flex-col gap-6">
      <ProfileHeader
        displayName={profile.display_name}
        avatarUrl={profile.avatar_url}
        identityVerified={profile.identity_verified}
        location={location}
        memberSince={memberSince}
        stats={[
          { label: COPY.statPosts, value: counts.posts, href: base },
          {
            label: COPY.statFollowers,
            value: counts.followers,
            href: profileTabHref(base, "seguidores"),
          },
          {
            label: COPY.statFollowing,
            value: counts.following,
            href: profileTabHref(base, "siguiendo"),
          },
        ]}
        // Menú ⋯ con "Reportar como estafa" SIEMPRE primero (§3.3 / §4.c).
        headerRight={<ProfileActionsMenu profileId={profile.id} />}
        // 1 CTA primario por pantalla: hilo real si ya hay conversación; si no,
        // estado honesto (el contacto perfil→perfil llega con el módulo social).
        // "Compartir" va al lado como secundario, nunca compitiendo con él.
        actions={
          <>
            {existingConversation ? (
              <Link
                href={`/mensajes/${existingConversation.id}`}
                className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
              >
                <ChatCircle size={20} aria-hidden="true" />
                {COPY.sendMessage}
              </Link>
            ) : (
              <MessageCta firstName={firstName} />
            )}
            <ShareProfileButton path={base} displayName={profile.display_name} />
          </>
        }
      />

      {/* Trust Score — visible al ver el perfil de CUALQUIER persona (feedback 21/7). */}
      <TrustScoreCard
        firstName={firstName}
        score={score}
        level={level}
        signals={signals}
        heading={COPY.trustHeading(firstName)}
      />

      {profile.bio && (
        <p className="text-center text-sm leading-relaxed text-foreground-secondary">
          {profile.bio}
        </p>
      )}

      {/* Las siete pestañas — la MISMA sección que el perfil propio. */}
      <ProfileTabSection
        supabase={supabase}
        tenantId={tenant.id}
        profileId={id}
        baseHref={base}
        tab={tab}
        counts={counts}
        isOwn={false}
        cursor={cursor}
        info={{
          bio: profile.bio,
          country,
          areaLabel: profile.area_label,
          memberSince,
          identityVerified: profile.identity_verified,
        }}
      />
    </div>
  );
}
