import type { ReactNode } from "react";
import { BezelCard } from "@/components/ui";

/**
 * Primitivos de prosa legal (Términos, Privacidad, Normas). Tipografía y
 * espaciado en espejo con `components/marketing/markdown.tsx` (guías) para
 * que toda la prosa pública del sitio se sienta de la misma familia, sin
 * tocar ese archivo (fuera de la propiedad de este agente).
 */

/** Fecha humana única para los documentos legales de este lanzamiento. */
export const LEGAL_LAST_UPDATED = "agosto de 2026";

/**
 * ⚠️ PENDIENTE DE NEGOCIO — NO ES UNA DECISIÓN TÉCNICA.
 *
 * El RGPD (art. 13.1) y la CCPA exigen un canal REAL para ejercer derechos. Sin
 * esto, el derecho de acceso, rectificación y oposición no se puede ejercer:
 * la persona lee que puede escribirnos y no hay a dónde.
 *
 * Estaba escrito a mano en tres lugares distintos como
 * "[correo de contacto legal — completar]". Se centraliza acá para que
 * completarlo sea UNA línea y no una búsqueda por el repo — y para que quede a
 * la vista de quien revise, en vez de escondido a mitad de una página.
 *
 * `null` = todavía sin definir. `<LegalContact />` lo dice explícitamente en
 * vez de mostrar un corchete que parece un error de programación.
 */
export const LEGAL_CONTACT_EMAIL: string | null = null;

/** Estado cuya ley rige los Términos. Mismo caso: falta decisión del cliente. */
export const LEGAL_GOVERNING_STATE: string | null = null;

/**
 * Cómo contactarnos. Mientras no haya correo, se dice la verdad —"escribinos
 * por la app"— en vez de mostrar un texto de relleno. Un canal que existe hoy
 * es mejor que uno que va a existir.
 */
export function LegalContact() {
  if (LEGAL_CONTACT_EMAIL) {
    return (
      <a
        href={`mailto:${LEGAL_CONTACT_EMAIL}`}
        className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
      >
        {LEGAL_CONTACT_EMAIL}
      </a>
    );
  }
  return (
    <span>
      el formulario de reportes de la app, eligiendo <em>«Otro tema»</em>
    </span>
  );
}

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
      <ol className="mt-1">
        {items.map((item, index) => (
          <li key={item.id}>
            {/* min-h-11: el índice de un documento legal se toca con el pulgar,
                en un teléfono, muchas veces seguidas. Con `min-h-6` los enlaces
                medían 24px —el mínimo de WCAG AA, pero por debajo de la barra
                del repo (≥44px)— y quedaban a 6px uno de otro: en esa densidad
                el error de toque es constante. El aire lo pone el propio
                target, así que la lista no crece de más. */}
            <a
              href={`#${item.id}`}
              className="inline-flex min-h-11 items-center gap-2 text-sm text-foreground-secondary transition-colors hover:text-brand-ink"
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
