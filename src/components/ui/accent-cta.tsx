import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

/**
 * CTA en píldora con el ACENTO del módulo (feedback cliente 2026-07-21: el botón
 * "Ver detalles" deja de ser gris). Es el patrón que ya usaban ListingCard y
 * FeedListingCard, extraído a un único lugar para que TODAS las cards de
 * directorio (eventos, profesionales, creadores, gigs, productos) lo compartan.
 *
 * El acento viaja en el borde/tinte y en la flecha; el texto queda en
 * `text-foreground` para no arriesgar contraste (mismo criterio AA que
 * EntityKindChip — p. ej. el amarillo de negocios no sería AA como color de
 * texto). Server-safe: es sólo un <Link>, sin estado ni handlers.
 *
 * `accent` es una custom property del tema (ej. `var(--accent-eventos)`), nunca
 * un color crudo hardcodeado.
 */
export function AccentLink({
  accent,
  href,
  children,
  className,
  ariaLabel,
}: {
  accent: string;
  href: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      style={{
        borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${accent} 12%, transparent)`,
      }}
      className={cn(
        "mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-semibold text-foreground",
        "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      {children}
      <ArrowRight size={16} aria-hidden="true" style={{ color: accent }} />
    </Link>
  );
}
