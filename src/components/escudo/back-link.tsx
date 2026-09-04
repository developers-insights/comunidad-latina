import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

/**
 * Volver con un `href` fijo, en línea con el contenido.
 *
 * QUEDA SÓLO PARA EL PANEL DE ADMIN (`/admin/empleos/[id]`). En la app lo
 * reemplazó `SectionTopBar` el 2026-09-04: las subpáginas del Escudo —de donde
 * salió este componente— ahora usan la misma barra pegajosa que el resto de la
 * app, con `router.back()` primero y el href como red de seguridad. Acá no
 * sirve esa barra: el admin tiene su propio header, de otra altura, y esta
 * barra se posiciona contra el del shell (59px).
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
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      <CaretLeft size={16} aria-hidden="true" />
      {label}
    </Link>
  );
}
