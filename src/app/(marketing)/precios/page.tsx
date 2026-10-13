import type { Metadata } from "next";
import Link from "next/link";
import { Check, EnvelopeSimple, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { JsonLd } from "@/components/marketing/json-ld";
import { BezelCard } from "@/components/ui";
import { SUPPORT_EMAIL } from "@/lib/support/contact";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { getPublicPrices } from "./data";
import { FREE_ITEMS, buildPriceGroups } from "./model";
import { PriceCard } from "./price-card";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const title = `Precios — ${tenant.name}`;
  const description =
    "Todo lo que se puede pagar en la comunidad, con su precio en dólares: planes para negocios, check azul, membresía de tienda, impulsos y campañas. Usar la plataforma es gratis.";
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/precios` },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "es_US",
      images: [{ url: "/brand/og-logo.png", width: 1200, height: 630 }],
    },
  };
}

const GRID_COLS: Record<number, string> = {
  1: "lg:grid-cols-2",
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 lg:grid-cols-3",
};

export default async function PreciosPage() {
  const tenant = await getTenant();
  const groups = buildPriceGroups(await getPublicPrices(tenant));

  return (
    <div>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `Precios — ${tenant.name}`,
          inLanguage: "es",
          url: `${SITE_URL}/precios`,
          publisher: { "@type": "Organization", name: "Comunidad Latina", url: SITE_URL },
        }}
      />

      <header className="relative isolate overflow-hidden border-b border-border-subtle bg-surface">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(var(--color-border-subtle)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(120%_90%_at_15%_0%,black,transparent_75%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-32 -z-10 size-[28rem] rounded-full bg-brand-tint opacity-70 blur-3xl"
        />
        <div className="mx-auto w-full max-w-5xl px-4 pb-14 pt-16 sm:pb-20 sm:pt-24">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-ink">Precios</p>
          <h1 className="mt-3 max-w-2xl font-display text-[2rem] font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl">
            Lo que cuesta cada cosa, antes de que pagues
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-foreground-secondary">
            Usar la comunidad es gratis. Acá está todo lo que se puede pagar, para qué sirve y
            cuánto sale.
          </p>
          <p className="mt-8 inline-flex max-w-full items-start gap-2.5 rounded-lg border border-border-subtle bg-canvas/80 px-4 py-3 text-sm text-foreground backdrop-blur-sm">
            <ShieldCheck size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-brand-ink" />
            <span>
              Todo en dólares estadounidenses (USD). Los pagos los procesa Stripe.
            </span>
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:py-20">
        <section aria-labelledby="gratis">
          <BezelCard variant="success" coreClassName="p-6 sm:p-8">
            <h2 id="gratis" className="font-display text-2xl font-bold tracking-tight text-foreground">
              Gratis, siempre
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground-secondary">
              No hace falta pagar nada para ser parte de la comunidad.
            </p>
            <ul className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {FREE_ITEMS.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-foreground">
                  <Check size={18} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
                  {item}
                </li>
              ))}
            </ul>
          </BezelCard>
        </section>

        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`grupo-${group.id}`} className="mt-16 sm:mt-24">
            <h2
              id={`grupo-${group.id}`}
              className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
            >
              {group.title}
            </h2>
            <p className="mt-2 max-w-xl text-foreground-secondary">{group.lead}</p>
            <div className={cn("mt-8 grid grid-cols-1 gap-5", GRID_COLS[group.blocks.length])}>
              {group.blocks.map((block) => (
                <PriceCard key={block.id} block={block} />
              ))}
            </div>
          </section>
        ))}

        <section
          aria-labelledby="dudas"
          className="mt-16 border-t border-border-subtle pt-10 sm:mt-24"
        >
          <h2 id="dudas" className="font-display text-xl font-bold tracking-tight text-foreground">
            Antes de pagar
          </h2>
          <ul className="mt-4 flex flex-col gap-x-8 sm:flex-row sm:flex-wrap">
            <li>
              <Link
                href="/legal/reembolsos"
                className="inline-flex min-h-11 items-center text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 transition-colors hover:decoration-brand-ink"
              >
                Cancelación y reembolsos
              </Link>
            </li>
            <li>
              <Link
                href="/legal/terminos"
                className="inline-flex min-h-11 items-center text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 transition-colors hover:decoration-brand-ink"
              >
                Términos y condiciones
              </Link>
            </li>
          </ul>
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-secondary">
            <EnvelopeSimple size={16} aria-hidden="true" className="shrink-0" />
            ¿Tenés una duda con un cobro? Escribinos a
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="break-all font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
