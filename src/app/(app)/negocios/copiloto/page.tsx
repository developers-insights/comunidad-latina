import Link from "next/link";
import { redirect } from "next/navigation";
import { MagicWand, Storefront } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, ProximamentePremium, buttonVariants } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { isOpenAIConfigured } from "@/lib/config/services";
import { cn } from "@/lib/utils";
import { CopilotoForm, type PrefillListing } from "./copiloto-form";

export const metadata = { title: "Copiloto de Negocios" };

/**
 * /negocios/copiloto (módulo MATCHING+COPILOTO) — herramienta simple y
 * honesta para dueños de negocio: mejores títulos, mejor descripción y
 * 3 ideas de post. Gate: dueño de business_account o de listing
 * business|professional. Sin OpenAI → ProximamentePremium (§5.6).
 */

const COPY = {
  titulo: "Copiloto de Negocios",
  subtitulo:
    "Contá tu negocio como se merece: pegá tu título y descripción, y el Copiloto te sugiere cómo mejorarlos.",
  gateTitulo: "El Copiloto es para dueños de negocio",
  gateTexto:
    "Publicá tu negocio o tu servicio profesional en la comunidad y el Copiloto queda disponible para vos.",
  gateCtaPublicar: "Publicar mi negocio",
  gateCtaPresencia: "Conocer Presencia Verificada",
  featureName: "el Copiloto de Negocios",
} as const;

export default async function CopilotoPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/entrar?next=/negocios/copiloto");
  }

  // Gate de dueño: business_account propia o listing business|professional.
  // Con el cliente del usuario — RLS aplica (solo ve lo suyo en tablas owner-only).
  const [accountResult, listingsResult] = await Promise.all([
    supabase
      .from("business_accounts")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("owner_id", user.id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("listings")
      .select("id, title, description")
      .eq("tenant_id", tenant.id)
      .eq("created_by", user.id)
      .in("kind", ["business", "professional"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const ownListings = listingsResult.data ?? [];
  const isOwner = Boolean(accountResult.data) || ownListings.length > 0;

  return (
    <>
      <header>
        <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-foreground">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-brand"
          >
            <MagicWand size={20} weight="light" />
          </span>
          {COPY.titulo}
        </h1>
        <p className="mt-1 max-w-[52ch] text-sm text-foreground-secondary">
          {COPY.subtitulo}
        </p>
      </header>

      {!isOwner ? (
        <BezelCard
          variant="featured"
          className="mt-6"
          coreClassName="flex flex-col items-center gap-3 px-6 py-10 text-center"
        >
          <span
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand"
          >
            <Storefront size={24} weight="light" />
          </span>
          <p className="font-display text-lg font-semibold text-foreground">
            {COPY.gateTitulo}
          </p>
          <p className="max-w-[42ch] text-sm text-foreground-secondary">{COPY.gateTexto}</p>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
            <Link
              href="/publicar"
              className={buttonVariants({ variant: "primary", size: "sm" })}
            >
              {COPY.gateCtaPublicar}
            </Link>
            <Link
              href="/negocios/presencia"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              {COPY.gateCtaPresencia}
            </Link>
          </div>
        </BezelCard>
      ) : !isOpenAIConfigured ? (
        <ProximamentePremium
          feature={COPY.featureName}
          icon={<MagicWand size={24} weight="light" />}
          className="mt-6"
        />
      ) : (
        <CopilotoForm
          listings={ownListings.map(
            (listing): PrefillListing => ({
              id: listing.id,
              title: listing.title,
              description: listing.description ?? "",
            }),
          )}
        />
      )}
    </>
  );
}
