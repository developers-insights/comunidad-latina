import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  CalendarCheck,
  HandPalm,
  HouseLine,
  MagnifyingGlass,
  SealCheck,
  ShieldCheck,
  Storefront,
} from "@phosphor-icons/react/dist/ssr";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { BezelCard, buttonVariants } from "@/components/ui";
import { COPY, gentilicioDe } from "@/components/marketing/copy";
import {
  fetchPublishedGuides,
  fetchRecentProperties,
  toGuideCardData,
} from "@/components/marketing/data";
import { GuideCard } from "@/components/marketing/guide-card";
import { HeroBackdrop } from "@/components/marketing/hero-backdrop";
import { ListingMiniCard } from "@/components/marketing/listing-mini-card";
import { JsonLd } from "@/components/marketing/json-ld";
import { Reveal } from "@/components/marketing/reveal";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const gentilicio = gentilicioDe(tenant.slug);
  const description = `El lugar donde ${gentilicio} que llegan encuentran a su gente y resuelven su vida — vivienda revisada, guías de trámites en tu idioma y verificación contra registros oficiales.`;

  return {
    title: `${tenant.name} — Tu comunidad de confianza`,
    description,
    keywords: [
      `comunidad ${tenant.slug}`,
      "vivienda verificada",
      "apartamentos queens",
      "guías para inmigrantes",
      "ITIN sin SSN",
      "licencia de conducir NY",
      "verificación comunitaria",
    ],
    openGraph: {
      title: `${tenant.name} — Tu comunidad de confianza`,
      description,
      type: "website",
      locale: "es_US",
      images: [{ url: "/images/og-default.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${tenant.name} — Tu comunidad de confianza`,
      description,
    },
  };
}

const PILLAR_ICONS = {
  vivienda: HouseLine,
  escudo: ShieldCheck,
  guias: BookOpenText,
} as const;

const STEP_ICONS = [MagnifyingGlass, CalendarCheck, HandPalm] as const;

export default async function MarketingHome() {
  const tenant = await getTenant();
  const [guides, listings] = await Promise.all([
    fetchPublishedGuides(3),
    fetchRecentProperties(4),
  ]);
  const featuredGuides = guides.map(toGuideCardData);
  const gentilicio = gentilicioDe(tenant.slug);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: tenant.name,
          url: SITE_URL,
          logo: `${SITE_URL}/images/og-default.png`,
          description: COPY.hero.h1(gentilicio),
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: tenant.name,
          url: SITE_URL,
          inLanguage: "es",
        }}
      />

      {/* (a) Hero */}
      <section className="relative isolate overflow-hidden bg-media-backdrop">
        <HeroBackdrop />

        {/* El pb-80 del móvil no es aire: abre la franja donde vive la familia de
            la foto vertical, debajo de la barra de confianza (ver HeroBackdrop).
            En ≥sm manda la foto apaisada y alcanza con el pb-32 de siempre. */}
        <div className="mx-auto flex w-full max-w-5xl flex-col items-start px-4 pb-80 pt-28 sm:pb-32 sm:pt-40">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-on-media/25 bg-on-media/10 px-4 py-1.5 text-sm font-medium text-on-media shadow-sm backdrop-blur-md">
              <ShieldCheck size={16} weight="fill" aria-hidden="true" />
              {COPY.hero.badge}
            </span>
          </Reveal>

          <Reveal delay={0.08}>
            <h1 className="mt-7 max-w-3xl font-display text-[2rem] font-bold leading-[1.08] tracking-tight text-on-media [text-shadow:0_2px_24px_rgba(0,0,0,0.35)] sm:text-4xl lg:text-[3.25rem] lg:leading-[1.05]">
              {COPY.hero.h1(gentilicio)}
            </h1>
          </Reveal>

          <Reveal delay={0.16}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-on-media/90">
              {COPY.hero.subhead}
            </p>
          </Reveal>

          <Reveal delay={0.24} className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/registro" className={buttonVariants({ variant: "primary", size: "lg" })}>
              {COPY.hero.ctaPrimary}
            </Link>
            <Link
              href="/propiedades"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "border-on-media/40 text-on-media hover:bg-on-media/10",
              )}
            >
              {COPY.hero.ctaSecondary}
            </Link>
          </Reveal>

          {/* Trust bar: señales de confianza premium, sobrias, sin números inventados. */}
          <Reveal delay={0.32} className="mt-10 w-full">
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-on-media/15 pt-6 text-sm text-on-media/85">
              {COPY.hero.trustSignals.map((signal) => (
                <li key={signal} className="inline-flex items-center gap-2">
                  <SealCheck size={16} weight="fill" className="shrink-0 text-on-media/70" aria-hidden="true" />
                  {signal}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* (b) Resolvé tu llegada — solo lo VIVO hoy (§2.3, honesto) */}
      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-24">
        <Reveal>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {COPY.pillars.title}
          </h2>
          <p className="mt-3 max-w-xl text-foreground-secondary">{COPY.pillars.subtitle}</p>
        </Reveal>

        {/* Columnas derivadas de la CANTIDAD de pilares, no fijas en 3: al
            ocultar Escudo (2026-07-20) quedaban 2 cards en una grilla de 3 y
            se veía un hueco. Así el landing no se rompe cada vez que un pilar
            entra o sale. */}
        <div
          className={cn(
            "mt-10 grid grid-cols-1 gap-5",
            COPY.pillars.items.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
          )}
        >
          {COPY.pillars.items.map((pillar, index) => {
            const Icon = PILLAR_ICONS[pillar.key];
            return (
              <Reveal key={pillar.key} delay={index * 0.08} className="h-full">
                <Link
                  href={pillar.href}
                  className={cn(
                    "group block h-full rounded-xl",
                    "transition-[transform,box-shadow] duration-(--duration-base) ease-(--ease-out-premium)",
                    "hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0",
                  )}
                >
                  <BezelCard className="h-full" coreClassName="flex h-full flex-col gap-3 p-6">
                    <span className="flex size-11 items-center justify-center rounded-md bg-brand-tint text-brand-ink">
                      <Icon size={24} weight="light" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-lg font-semibold">{pillar.title}</h3>
                    <p className="text-sm leading-relaxed text-foreground-secondary">
                      {pillar.body}
                    </p>
                    <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-medium text-brand-ink transition-transform duration-(--duration-fast) group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0">
                      {pillar.cta}
                      <ArrowRight size={16} aria-hidden="true" />
                    </span>
                  </BezelCard>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* (c) Social proof estructural: cómo funciona la verificación */}
      <section className="border-y border-border-subtle bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-24">
          <Reveal>
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              {COPY.verification.title}
            </h2>
            <p className="mt-3 text-foreground-secondary">{COPY.verification.subtitle}</p>
          </Reveal>

          <ol className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-3">
            {COPY.verification.steps.map((step, index) => {
              const Icon = STEP_ICONS[index];
              return (
                <Reveal key={step.title} delay={index * 0.08}>
                  <li className="flex flex-col gap-3">
                    <span className="flex size-11 items-center justify-center rounded-full bg-surface-subtle text-foreground">
                      <Icon size={22} weight="light" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-base font-semibold">
                      <span className="numeric mr-1.5 text-foreground-muted">{index + 1}.</span>
                      {step.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-foreground-secondary">
                      {step.body}
                    </p>
                  </li>
                </Reveal>
              );
            })}
          </ol>

          {/* Ejemplo literal del copy legal §11 */}
          <Reveal delay={0.2} className="mt-12">
            <p className="mb-3 text-sm font-medium text-foreground-muted">
              {COPY.verification.exampleLabel}
            </p>
            <BezelCard variant="success" className="max-w-2xl" coreClassName="p-5">
              <p className="flex items-start gap-2 text-sm font-medium text-success">
                <SealCheck size={18} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
                {COPY.verification.exampleDescriptor}
              </p>
              <p className="mt-2 pl-6 text-sm text-foreground-secondary">
                {COPY.verification.exampleDisclaimer}
              </p>
            </BezelCard>
          </Reveal>
        </div>
      </section>

      {/* (d) Guías destacadas (de la DB) */}
      {featuredGuides.length > 0 && (
        <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-24">
          <Reveal className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {COPY.guides.title}
              </h2>
              <p className="mt-3 max-w-xl text-foreground-secondary">{COPY.guides.subtitle}</p>
            </div>
            <Link
              href="/guias"
              className="group inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-ink"
            >
              {COPY.guides.allLink}
              <ArrowRight
                size={16}
                aria-hidden="true"
                className="transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
              />
            </Link>
          </Reveal>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredGuides.map((guide, index) => (
              <Reveal key={guide.slug} delay={index * 0.08} className="h-full">
                <GuideCard guide={guide} className="h-full" />
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* (e) Propiedades recientes (reales, de la DB) */}
      {listings.length > 0 && (
        <section className="border-t border-border-subtle bg-surface-subtle/50">
          <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-24">
            <Reveal className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                  {COPY.listings.title}
                </h2>
                <p className="mt-3 max-w-xl text-foreground-secondary">
                  {COPY.listings.subtitle}
                </p>
              </div>
              <Link
                href="/propiedades"
                className="group inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-ink"
              >
                {COPY.listings.allLink}
                <ArrowRight
                  size={16}
                  aria-hidden="true"
                  className="transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
                />
              </Link>
            </Reveal>

            <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {listings.map((listing, index) => (
                <Reveal key={listing.id} delay={index * 0.06} className="h-full">
                  <ListingMiniCard listing={listing} className="h-full" />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* (f) Banda para negocios */}
      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-24">
        <Reveal>
          <BezelCard variant="featured" coreClassName="flex flex-col items-start gap-4 p-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-brand-tint text-brand-ink">
                <Storefront size={26} weight="light" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-display text-xl font-bold tracking-tight">
                  {COPY.business.title}
                </h2>
                <p className="mt-1.5 max-w-md text-sm leading-relaxed text-foreground-secondary">
                  {COPY.business.body}
                </p>
              </div>
            </div>
            <Link
              href="/negocios/presencia"
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "shrink-0")}
            >
              {COPY.business.cta}
            </Link>
          </BezelCard>
        </Reveal>
      </section>
    </>
  );
}
