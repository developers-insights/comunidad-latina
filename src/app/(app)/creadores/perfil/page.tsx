import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import {
  COPY,
  CreatorProfileForm,
  CreatorRequirementsCard,
  SocialAudience,
  type CreatorProfileInitial,
} from "@/components/creators";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { fetchCreatorRequirements } from "./queries";

export const metadata = { title: "Mi perfil de creador" };

export default async function MiPerfilCreadorPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <EmptyState
        icon={<SignIn />}
        title={COPY.profile.needLoginTitle}
        message={COPY.profile.needLoginBody}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent("/creadores/perfil")}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.profile.needLoginCta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  const [{ data: existing }, { data: profile }] = await Promise.all([
    supabase
      .from("creator_profiles")
      .select("headline, bio, skills, rate_hint, available, portfolio_photos")
      .eq("profile_id", user.id)
      .maybeSingle(),
    supabase.from("profiles").select("created_at").eq("id", user.id).maybeSingle(),
  ]);

  // Requisitos para recibir trabajos (§6): datos reales, no un "no calificás".
  const stats = await fetchCreatorRequirements(
    supabase,
    tenant.id,
    user.id,
    profile?.created_at ?? null,
  );

  const initial: CreatorProfileInitial | null = existing
    ? {
        headline: existing.headline,
        bio: existing.bio,
        skills: existing.skills ?? [],
        rateHint: existing.rate_hint,
        available: existing.available,
        portfolioPaths: existing.portfolio_photos ?? [],
      }
    : null;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {COPY.profile.myTitle}
          </h1>
          <p className="mt-1 text-sm text-foreground-secondary">{COPY.profile.mySubtitle}</p>
        </div>
        {/* Acceso directo a las colaboraciones propias desde el perfil (pedido del
            cliente: que cada quien vea lo suyo desde su perfil). La vista destino
            ya filtra por la sesión y respeta RLS — no expone lo de terceros. */}
        <div className="flex flex-wrap gap-2">
          {/* La solicitud vive en su propia pantalla porque ahí se explica, uno
              por uno, qué requisito falta y cuánto (los umbrales los fija cada
              comunidad desde el panel — 0064). Desde acá se llega, si no, nadie
              la encontraría. */}
          <Link
            href="/creadores/solicitud"
            className={buttonVariants({ variant: "primary", size: "sm" })}
          >
            Quiero recibir trabajos
          </Link>
          <Link
            href="/creadores/colaboraciones"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {COPY.contractsList.title}
          </Link>
        </div>
      </header>

      {/* Arriba del formulario a propósito: es lo primero que alguien quiere
          saber cuando entra a su perfil de creador ("¿ya puedo recibir
          trabajos?"), y si falta algo, el formulario de abajo es justamente
          donde se empieza a resolver. */}
      <CreatorRequirementsCard
        result={stats.requirements}
        locale={tenant.locale}
        className="mb-4"
      />

      <SocialAudience
        communityFollowers={stats.followers}
        // Audiencia externa: hoy no hay dónde declararla ni de dónde traerla.
        // El componente la muestra como "todavía no lo medimos" — ver su cabecera.
        externalFollowers={null}
        locale={tenant.locale}
        className="mb-6"
      />

      <CreatorProfileForm tenantId={tenant.id} userId={user.id} initial={initial} />
    </>
  );
}
