import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

/**
 * Volver dentro del Escudo — target ≥44px, siempre arriba a la izquierda
 * en las subpáginas del módulo.
 */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-sm font-medium text-foreground-secondary",
        "transition-colors duration-(--duration-fast) hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]",
        className,
      )}
    >
      <CaretLeft size={16} aria-hidden="true" />
      {label}
    </Link>
  );
}
