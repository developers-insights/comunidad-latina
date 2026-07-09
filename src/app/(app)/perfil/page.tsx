import { redirect } from "next/navigation";
import Link from "next/link";
import { CaretRight, MapPin, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { Avatar, BezelCard } from "@/components/ui";
import { Button } from "@/components/ui";
import { IdentityBadge } from "@/components/auth/identity-badge";
import { TrustBlock } from "@/components/auth/trust-block";
import { EditProfileForm } from "@/components/auth/edit-profile-form";
import { DeleteAccount } from "@/components/auth/delete-account";
import { countryName } from "@/components/auth/countries";
import {
  normalizeTrustLevel,
  trustSignalsFrom,
} from "@/components/auth/trust-signals";
import { signOutAction } from "./actions";

export const metadata = { title: "Tu perfil" };

const COPY = {
  title: "Tu perfil",
  trustHeading: "Tu Trust Score",
  trustHint:
    "Crece con tu tiempo en la comunidad, tus verificaciones y el aval de tus vecinos.",
  editHeading: "Editar tu perfil",
  helpHeading: "Ayuda y seguridad",
  securityTitle: "Centro de seguridad",
  securityDesc: "Verificaciones, reportes y guías para cuidar a tu familia.",
  sessionHeading: "Tu cuenta",
  signOut: "Cerrar sesión",
  deleteHint:
    "Si eliminás tu cuenta, borramos todo lo tuyo de verdad — perfil, publicaciones y mensajes.",
} as const;

export default async function PerfilPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/perfil");

  const [{ data: profile }, { data: trust }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("trust_scores").select("score, level, signals").eq("profile_id", user.id).maybeSingle(),
  ]);

  // Cuenta sin perfil (edge raro) → que complete el onboarding.
  if (!profile) redirect("/bienvenida");

  const score = trust?.score ?? 0;
  const level = normalizeTrustLevel(trust?.level, score);
  const signals = trustSignalsFrom(trust?.signals ?? null, profile.identity_verified);
  const firstName = profile.display_name.split(/\s+/)[0] ?? profile.display_name;
  const country = countryName(profile.country_origin);
  const meta = [country, profile.area_label].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-8">
      <h1 className="sr-only">{COPY.title}</h1>

      {/* Cabecera del perfil */}
      <section className="flex flex-col items-center gap-3 text-center">
        <Avatar
          size="xl"
          src={profile.avatar_url}
          name={profile.display_name}
          badge={profile.identity_verified ? <IdentityBadge /> : undefined}
        />
        <div className="flex flex-col gap-0.5">
          <p className="font-display text-xl font-bold text-foreground">
            {profile.display_name}
          </p>
          {meta && (
            <p className="flex items-center justify-center gap-1 text-sm text-foreground-secondary">
              <MapPin size={14} aria-hidden="true" />
              {meta}
            </p>
          )}
          <p className="text-xs text-foreground-muted">{user.email}</p>
        </div>
      </section>

      {/* Trust Score propio — siempre clickeable, siempre explica */}
      <section className="flex flex-col gap-2" aria-label={COPY.trustHeading}>
        <TrustBlock
          firstName={firstName}
          score={score}
          level={level}
          signals={signals}
        />
        <p className="px-1 text-xs text-foreground-muted">{COPY.trustHint}</p>
      </section>

      {/* Editar */}
      <BezelCard>
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

      {/* Ayuda y seguridad — hogar del Escudo, ahora fuera del nav principal */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {COPY.helpHeading}
        </h2>
        <Link
          href="/escudo"
          className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <BezelCard coreClassName="flex items-center gap-4 p-5">
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
            >
              <ShieldCheck size={26} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-semibold text-foreground">
                {COPY.securityTitle}
              </span>
              <span className="mt-0.5 block text-sm text-foreground-secondary">
                {COPY.securityDesc}
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

      {/* Cuenta: cerrar sesión + eliminar (alto riesgo, al final) */}
      <section className="flex flex-col gap-3 border-t border-border-subtle pt-6">
        <h2 className="text-sm font-semibold text-foreground">
          {COPY.sessionHeading}
        </h2>
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
