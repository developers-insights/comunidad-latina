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
import { ProfilePostsGrid } from "../posts-grid";
import { fetchAuthorPostTiles } from "../posts";

export const metadata = { title: "Perfil" };

const COPY = {
  sendMessage: "Enviar mensaje",
  loginTitle: "Este perfil es de la comunidad",
  loginMessage:
    "Entrá a tu cuenta para ver los perfiles y el Trust Score de tus vecinos.",
  loginCta: "Entrar",
  statPosts: "Publicaciones",
  statFollowing: "Siguiendo",
  postsHeading: "Publicaciones",
  postsEmpty: "Todavía no publicó nada. Cuando comparta algo, va a aparecer acá.",
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

  // Con perfil (⇒ hay sesión por RLS): conversación previa + contadores reales
  // + primera página de publicaciones, todo en paralelo.
  const [
    { data: existingConversation },
    { count: postsCount },
    { count: followingCount },
    postsPage,
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, status, created_at")
      .or(`created_by.eq.${id},counterpart_id.eq.${id}`)
      .neq("status", "blocked")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("author_id", id)
      .eq("status", "published"),
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("follower_id", id),
    fetchAuthorPostTiles(supabase, { tenantId: tenant.id, authorId: id, cursor }),
  ]);

  const score = trust?.score ?? 0;
  const level = normalizeTrustLevel(trust?.level, score);
  const signals = trustSignalsFrom(trust?.signals ?? null, profile.identity_verified);
  const firstName = profile.display_name.split(/\s+/)[0] ?? profile.display_name;
  const country = countryName(profile.country_origin);
  const location = [country, profile.area_label].filter(Boolean).join(" · ") || null;

  const nextHref = postsPage.nextCursor
    ? `/perfil/${id}?fotos=${postsPage.nextCursor}`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <ProfileHeader
        displayName={profile.display_name}
        avatarUrl={profile.avatar_url}
        identityVerified={profile.identity_verified}
        location={location}
        stats={[
          { label: COPY.statPosts, value: postsCount ?? 0 },
          { label: COPY.statFollowing, value: followingCount ?? 0 },
        ]}
        // Menú ⋯ con "Reportar como estafa" SIEMPRE primero (§3.3 / §4.c).
        headerRight={<ProfileActionsMenu profileId={profile.id} />}
        // 1 CTA primario por pantalla: hilo real si ya hay conversación; si no,
        // estado honesto (el contacto perfil→perfil llega con el módulo social).
        actions={
          existingConversation ? (
            <Link
              href={`/mensajes/${existingConversation.id}`}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
            >
              <ChatCircle size={20} aria-hidden="true" />
              {COPY.sendMessage}
            </Link>
          ) : (
            <MessageCta firstName={firstName} />
          )
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

      {/* Grid de publicaciones del autor. */}
      <ProfilePostsGrid
        tiles={postsPage.tiles}
        nextHref={nextHref}
        heading={COPY.postsHeading}
        emptyMessage={COPY.postsEmpty}
      />
    </div>
  );
}
