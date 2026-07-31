import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Briefcase,
  CaretRight,
  GearSix,
  PencilSimple,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { BezelCard, buttonVariants } from "@/components/ui";
import { TrustScoreCard } from "@/components/trust";
import { decodeCursor } from "@/components/listings";
import { EditProfileForm } from "@/components/auth/edit-profile-form";
import { countryName } from "@/components/auth/countries";
import {
  normalizeTrustLevel,
  trustSignalsFrom,
} from "@/components/auth/trust-signals";
import { cn } from "@/lib/utils";
import { ProfileHeader } from "../profile-header";
import { ShareProfileButton } from "../share-profile-button";
import { ProfileTabSection } from "../profile-tab-section";
import { fetchProfileCounts } from "../profile-data";
import { memberSinceLabel, parseProfileTab, profileTabHref } from "../profile-tabs";

export const metadata = { title: "Tu perfil" };

const COPY = {
  editAction: "Editar perfil",
  verifyAction: "Verificar",
  statPosts: "Publicaciones",
  statFollowers: "Seguidores",
  statFollowing: "Siguiendo",
  trustHeading: "Tu Trust Score",
  trustHint:
    "Crece con tu tiempo en la comunidad, tus verificaciones y el aval de tus vecinos.",
  editHeading: "Editar tu perfil",
  contractsTitle: "Mis contratos",
  contractsDesc: "Los trabajos que contrataste o entregaste como creador.",
  settingsTitle: "Ajustes de tu cuenta",
  settingsDesc:
    "Guardados, notificaciones, personas bloqueadas, tema y cerrar sesión.",
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
  const tab = parseProfileTab(firstValue(sp.t) || undefined);

  // Perfil + Trust Score + los cuatro contadores + acceso a contratos.
  const [{ data: profile }, { data: trust }, counts, { count: contractsCount }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase
        .from("trust_scores")
        .select("score, level, signals")
        .eq("profile_id", user.id)
        .maybeSingle(),
      fetchProfileCounts(supabase, { tenantId: tenant.id, profileId: user.id }),
      // Acceso a "Mis contratos" (pedido cliente 26/7, movido del nav de
      // Creadores): solo se muestra si el usuario tiene algo que ver ahí — como
      // cliente o como creador — para no ofrecerle a cualquiera un atajo vacío.
      supabase
        .from("gig_contracts")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .or(`client_id.eq.${user.id},creator_id.eq.${user.id}`),
    ]);

  // Cuenta sin perfil (edge raro) → que complete el onboarding.
  if (!profile) redirect("/bienvenida");

  const score = trust?.score ?? 0;
  const level = normalizeTrustLevel(trust?.level, score);
  const signals = trustSignalsFrom(trust?.signals ?? null, profile.identity_verified);
  const firstName = profile.display_name.split(/\s+/)[0] ?? profile.display_name;
  const country = countryName(profile.country_origin);
  const location = [country, profile.area_label].filter(Boolean).join(" · ") || null;
  const memberSince = memberSinceLabel(profile.created_at, tenant.locale);

  return (
    <div className="flex flex-col gap-8">
      <ProfileHeader
        displayName={profile.display_name}
        avatarUrl={profile.avatar_url}
        identityVerified={profile.identity_verified}
        location={location}
        memberSince={memberSince}
        stats={[
          { label: COPY.statPosts, value: counts.posts, href: "/perfil" },
          {
            label: COPY.statFollowers,
            value: counts.followers,
            href: profileTabHref("/perfil", "seguidores"),
          },
          {
            label: COPY.statFollowing,
            value: counts.following,
            href: profileTabHref("/perfil", "siguiendo"),
          },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
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
            {/* Compartir el perfil PROPIO apunta a su URL pública (`/perfil/<id>`),
                no a `/perfil`: esta última redirige a "tu perfil" para quien
                abra el link, o sea que compartirla mandaría a cada persona a su
                propio perfil. Es el bug clásico de este botón. */}
            <ShareProfileButton
              path={`/perfil/${profile.id}`}
              displayName={profile.display_name}
            />
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

      {/* Las siete pestañas (contrato 2026-07-30 §B.6). Publicaciones · Fotos ·
          Videos · Información · Reseñas · Seguidores · Siguiendo. */}
      <ProfileTabSection
        supabase={supabase}
        tenantId={tenant.id}
        profileId={user.id}
        baseHref="/perfil"
        tab={tab}
        counts={counts}
        isOwn
        cursor={cursor}
        info={{
          bio: profile.bio,
          country,
          areaLabel: profile.area_label,
          memberSince,
          identityVerified: profile.identity_verified,
        }}
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

      {/* Mis contratos — solo si el usuario tiene alguno (cliente o creador). */}
      {Boolean(contractsCount) && (
        <section className="flex flex-col gap-3">
          <Link
            href="/creadores/contratos"
            className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            <BezelCard coreClassName="flex items-center gap-4 p-5">
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
              >
                <Briefcase size={26} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-base font-semibold text-foreground">
                  {COPY.contractsTitle}
                </span>
                <span className="mt-0.5 block text-sm text-foreground-secondary">
                  {COPY.contractsDesc}
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
      )}

      {/* Administrar la cuenta ya no vive acá (2026-07-29). Guardados, cuentas
          bloqueadas, tema y el bloque de sesión —cerrar sesión y eliminar la
          cuenta— se mudaron ENTEROS a /ajustes, la pestaña nueva del bottom nav.
          El perfil quedó para lo que es: quién sos de cara a la comunidad. Este
          enlace es el puente, para quien venía con el camino viejo en la cabeza. */}
      <section className="flex flex-col gap-3">
        <Link
          href="/ajustes"
          className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <BezelCard coreClassName="flex items-center gap-4 p-5">
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
            >
              <GearSix size={26} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-semibold text-foreground">
                {COPY.settingsTitle}
              </span>
              <span className="mt-0.5 block text-sm text-foreground-secondary">
                {COPY.settingsDesc}
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
    </div>
  );
}
