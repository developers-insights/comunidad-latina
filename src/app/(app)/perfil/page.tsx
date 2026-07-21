import { redirect } from "next/navigation";
import Link from "next/link";
import {
  CaretRight,
  PencilSimple,
  Prohibit,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { BezelCard, Button, buttonVariants } from "@/components/ui";
import { TrustScoreCard } from "@/components/trust";
import { decodeCursor } from "@/components/listings";
import { EditProfileForm } from "@/components/auth/edit-profile-form";
import { DeleteAccount } from "@/components/auth/delete-account";
import { countryName } from "@/components/auth/countries";
import {
  normalizeTrustLevel,
  trustSignalsFrom,
} from "@/components/auth/trust-signals";
import { cn } from "@/lib/utils";
import { signOutAction } from "./actions";
import { ProfileHeader } from "./profile-header";
import { ProfilePostsGrid } from "./posts-grid";
import { fetchAuthorPostTiles } from "./posts";

export const metadata = { title: "Tu perfil" };

const COPY = {
  editAction: "Editar perfil",
  verifyAction: "Verificar",
  postsHeading: "Tus publicaciones",
  postsEmpty:
    "Todavía no compartiste nada. Tu primera foto es el mejor comienzo para que la comunidad te conozca.",
  statPosts: "Publicaciones",
  statFollowing: "Siguiendo",
  trustHeading: "Tu Trust Score",
  trustHint:
    "Crece con tu tiempo en la comunidad, tus verificaciones y el aval de tus vecinos.",
  editHeading: "Editar tu perfil",
  helpHeading: "Ayuda y seguridad",
  blockedTitle: "Personas bloqueadas",
  blockedDesc: "Quiénes no pueden contactarte ni aparecer en tu feed.",
  sessionHeading: "Tu cuenta",
  sessionAs: (email: string) => `Sesión iniciada como ${email}.`,
  signOut: "Cerrar sesión",
  deleteHint:
    "Si eliminás tu cuenta, borramos todo lo tuyo de verdad — perfil, publicaciones y mensajes.",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [tenant, supabase, sp] = await Promise.all([
    getTenant(),
    createClient(),
    searchParams,
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/perfil");

  const cursor = decodeCursor(firstValue(sp.fotos) || undefined);

  // Perfil + Trust Score + contadores reales + primera página de publicaciones.
  const [
    { data: profile },
    { data: trust },
    { count: postsCount },
    { count: followingCount },
    postsPage,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("trust_scores")
      .select("score, level, signals")
      .eq("profile_id", user.id)
      .maybeSingle(),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("author_id", user.id)
      .eq("status", "published"),
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("follower_id", user.id),
    fetchAuthorPostTiles(supabase, {
      tenantId: tenant.id,
      authorId: user.id,
      cursor,
    }),
  ]);

  // Cuenta sin perfil (edge raro) → que complete el onboarding.
  if (!profile) redirect("/bienvenida");

  const score = trust?.score ?? 0;
  const level = normalizeTrustLevel(trust?.level, score);
  const signals = trustSignalsFrom(trust?.signals ?? null, profile.identity_verified);
  const firstName = profile.display_name.split(/\s+/)[0] ?? profile.display_name;
  const country = countryName(profile.country_origin);
  const location = [country, profile.area_label].filter(Boolean).join(" · ") || null;

  const nextHref = postsPage.nextCursor ? `/perfil?fotos=${postsPage.nextCursor}` : null;

  return (
    <div className="flex flex-col gap-8">
      <ProfileHeader
        displayName={profile.display_name}
        avatarUrl={profile.avatar_url}
        identityVerified={profile.identity_verified}
        location={location}
        stats={[
          { label: COPY.statPosts, value: postsCount ?? 0 },
          { label: COPY.statFollowing, value: followingCount ?? 0 },
        ]}
        actions={
          <div className="flex gap-2">
            <Link
              href="#editar-perfil"
              className={cn(buttonVariants({ variant: "secondary", size: "md" }), "flex-1")}
            >
              <PencilSimple size={16} aria-hidden="true" />
              {COPY.editAction}
            </Link>
            {!profile.identity_verified && (
              <Link
                href="/perfil/verificar"
                className={cn(buttonVariants({ variant: "outline", size: "md" }), "flex-1")}
              >
                <ShieldCheck size={16} aria-hidden="true" />
                {COPY.verifyAction}
              </Link>
            )}
          </div>
        }
      />

      {/* Trust Score — la tarjeta especial, con protagonismo visual (feedback 21/7). */}
      <section className="flex flex-col gap-2" aria-label={COPY.trustHeading}>
        <TrustScoreCard
          firstName={firstName}
          score={score}
          level={level}
          signals={signals}
          heading={COPY.trustHeading}
        />
        <p className="px-1 text-xs text-foreground-muted">{COPY.trustHint}</p>
      </section>

      {/* Grid de publicaciones — el perfil se siente red social. */}
      <ProfilePostsGrid
        tiles={postsPage.tiles}
        nextHref={nextHref}
        heading={COPY.postsHeading}
        emptyMessage={COPY.postsEmpty}
      />

      {/* Editar — destino del ancla "Editar perfil" de la cabecera. */}
      <BezelCard id="editar-perfil" className="scroll-mt-20">
        <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
          {COPY.editHeading}
        </h2>
        <EditProfileForm
          initial={{
            displayName: profile.display_name,
            bio: profile.bio ?? "",
            area: profile.area_label ?? "",
          }}
        />
      </BezelCard>

      {/* Ayuda y seguridad — bloqueo de personas y demás herramientas de cuidado */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {COPY.helpHeading}
        </h2>
        <Link
          href="/perfil/bloqueados"
          className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <BezelCard coreClassName="flex items-center gap-4 p-5">
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
            >
              <Prohibit size={26} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-semibold text-foreground">
                {COPY.blockedTitle}
              </span>
              <span className="mt-0.5 block text-sm text-foreground-secondary">
                {COPY.blockedDesc}
              </span>
            </span>
            <CaretRight
              size={18}
              aria-hidden="true"
              className="shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5"
            />
          </BezelCard>
        </Link>
      </section>

      {/* Cuenta: correo + cerrar sesión + eliminar (alto riesgo, al final) */}
      <section className="flex flex-col gap-3 border-t border-border-subtle pt-6">
        <h2 className="text-sm font-semibold text-foreground">
          {COPY.sessionHeading}
        </h2>
        {user.email && (
          <p className="text-xs text-foreground-muted">{COPY.sessionAs(user.email)}</p>
        )}
        <form action={signOutAction}>
          <Button type="submit" variant="outline">
            {COPY.signOut}
          </Button>
        </form>
        <p className="text-xs text-foreground-muted">{COPY.deleteHint}</p>
        <DeleteAccount />
      </section>
    </div>
  );
}
