import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY, CreatorProfileForm, type CreatorProfileInitial } from "@/components/creators";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";

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

  const { data: existing } = await supabase
    .from("creator_profiles")
    .select("headline, bio, skills, rate_hint, available, portfolio_photos")
    .eq("profile_id", user.id)
    .maybeSingle();

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
        {/* Acceso directo a los contratos propios desde el perfil (pedido del cliente:
            que cada quien vea sus contratos desde su perfil). La vista destino ya
            filtra por la sesión y respeta RLS — no expone contratos de terceros. */}
        <Link
          href="/creadores/contratos"
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          Mis contratos
        </Link>
      </header>
      <CreatorProfileForm tenantId={tenant.id} userId={user.id} initial={initial} />
    </>
  );
}
