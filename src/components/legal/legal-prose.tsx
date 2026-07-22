import type { ReactNode } from "react";
import { BezelCard } from "@/components/ui";

/**
 * Primitivos de prosa legal (Términos, Privacidad, Normas). Tipografía y
 * espaciado en espejo con `components/marketing/markdown.tsx` (guías) para
 * que toda la prosa pública del sitio se sienta de la misma familia, sin
 * tocar ese archivo (fuera de la propiedad de este agente).
 */

/** Fecha humana única para los 3 documentos legales de este lanzamiento. */
export const LEGAL_LAST_UPDATED = "julio de 2026";

export const legalProse = {
  p: "leading-relaxed text-foreground-secondary",
  ul: "list-disc space-y-2 pl-5 leading-relaxed text-foreground-secondary marker:text-foreground-muted",
  ol: "list-decimal space-y-2 pl-5 leading-relaxed text-foreground-secondary marker:font-semibold marker:text-foreground",
  strong: "font-semibold text-foreground",
} as const;

export function LegalHeader({
  title,
  intro,
}: {
  title: string;
  intro: ReactNode;
}) {
  return (
    <header>
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-ink">
        Última actualización: {LEGAL_LAST_UPDATED}
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-foreground-secondary">
        {intro}
      </p>
    </header>
  );
}

export type LegalTocItem = { id: string; label: string };

export function LegalToc({ items }: { items: LegalTocItem[] }) {
  return (
    <nav
      aria-label="Contenido de este documento"
      className="mt-8 rounded-lg border border-border-subtle bg-surface-subtle p-5"
    >
      <p className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
        En este documento
      </p>
      <ol className="mt-3 space-y-1.5">
        {items.map((item, index) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="inline-flex min-h-6 items-baseline gap-2 text-sm text-foreground-secondary transition-colors hover:text-brand-ink"
            >
              <span className="text-foreground-muted">{index + 1}.</span>
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-24 first:mt-0">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

/**
 * Recuadro destacado. `warning` para reglas de oro sin excepciones (nunca
 * mandes dinero por adelantado); `info` (default) para aclaraciones — mismo
 * patrón visual Double-Bezel que el resto del sitio.
 */
export function LegalCallout({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning";
  children: ReactNode;
}) {
  if (tone === "warning") {
    return (
      <blockquote className="rounded-md border-l-4 border-warning bg-warning-bg px-4 py-3 text-sm leading-relaxed text-foreground">
        {children}
      </blockquote>
    );
  }
  return (
    <BezelCard
      variant="featured"
      coreClassName="p-5 text-sm leading-relaxed text-foreground-secondary"
    >
      {children}
    </BezelCard>
  );
}
