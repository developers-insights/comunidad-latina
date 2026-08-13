import type { ReactNode } from "react";
import Link from "next/link";
import { BRAND_NAME } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";
import { COPY } from "@/components/marketing/copy";
import { LanguageToggle } from "@/components/marketing/language-toggle";

/** Layout público: header liviano con nav + footer premium con disclaimer §11. */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-foreground">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg focus:ring-[3px] focus:ring-focus-ring"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4">
          {/*
            A /guias y no a "/": `/` redirige a `/entrar`, así que el logo
            mandaba al login a quien llegó a una guía desde Google. Esa persona
            todavía no tiene cuenta ni la está buscando — está leyendo. /guias
            es el índice público de esta superficie, o sea su verdadero inicio.
          */}
          <Link
            href="/guias"
            className="rounded-full font-display text-lg font-bold tracking-tight text-brand-ink"
          >
            {/* Marca del programa, no nombre del tenant. Ver @/lib/brand. */}
            {BRAND_NAME}
          </Link>

          {/* El toggle de tema no es navegación: vive al lado del nav, no adentro. */}
          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />

            <nav aria-label="Principal" className="flex items-center gap-1 sm:gap-2">
              <Link
                href="/guias"
                className="hidden min-h-11 items-center rounded-md px-3 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground sm:inline-flex"
              >
                Guías
              </Link>
              <Link
                href="/propiedades"
                className="hidden min-h-11 items-center rounded-md px-3 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground sm:inline-flex"
              >
                Propiedades
              </Link>
              <Link href="/entrar" className={buttonVariants({ variant: "primary", size: "sm" })}>
                {t("common", "enter")}
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main id="contenido" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>

      {/* (g) Footer premium */}
      <footer className="border-t border-border-subtle bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:py-16">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-1">
              <p className="font-display text-lg font-bold tracking-tight text-brand-ink">
                {BRAND_NAME}
              </p>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-foreground-secondary">
                {COPY.footer.tagline}
              </p>
              <div className="mt-5">
                <LanguageToggle />
              </div>
            </div>

            <nav aria-label={COPY.footer.exploreTitle}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
                {COPY.footer.exploreTitle}
              </h3>
              <ul className="mt-4 space-y-3">
                {COPY.footer.explore.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-sm text-foreground-secondary transition-colors hover:text-foreground"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-label={COPY.footer.communityTitle}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
                {COPY.footer.communityTitle}
              </h3>
              <ul className="mt-4 space-y-3">
                {COPY.footer.community.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-sm text-foreground-secondary transition-colors hover:text-foreground"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
                {COPY.footer.legalTitle}
              </h3>
              <ul className="mt-4 space-y-3">
                {COPY.footer.legal.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-sm text-foreground-secondary transition-colors hover:text-foreground"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Disclaimer legal §11 — descriptor literal + fecha + regla de oro */}
          <div className="mt-12 border-t border-border-subtle pt-6">
            <p className="max-w-3xl text-xs leading-relaxed text-foreground-muted">
              {COPY.footer.disclaimer}
            </p>
            <p className="mt-4 text-xs text-foreground-muted">
              {/* El copyright es de la MARCA. Antes decía "{tenant.name} · Una
                  comunidad de Comunidad Latina", que con el tenant llamado
                  "Comunidad Latina" quedaba "Comunidad Latina · Una comunidad de
                  Comunidad Latina". Ver @/lib/brand. */}
              © {new Date().getFullYear()} {BRAND_NAME} · {COPY.footer.tagline}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
