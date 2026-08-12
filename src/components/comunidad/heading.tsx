import type { ReactNode } from "react";
import { Bubble } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Acento del módulo (globals.css). Una sola constante para todo Comunidad. */
export const COMUNIDAD_ACCENT = "var(--accent-comunidad)";

export interface ComunidadHeadingProps {
  /** Ícono Phosphor de la pantalla, ya instanciado (28px). Decorativo. */
  icon: ReactNode;
  title: string;
  subtitle?: string;
  as?: "h1" | "h2";
  className?: string;
}

/**
 * Cabecera de las pantallas de Comunidad.
 *
 * Es la MISMA cápsula que `<SectionHeading>` —relleno tintado del módulo,
 * hairline del acento, título y bajada— con una sola diferencia: el chip lleva
 * un ícono Phosphor en vez del render 3D del set del menú, porque Comunidad
 * todavía no tiene el suyo en `/public/icons/menu/`. Reusar el asset de otro
 * módulo sería peor que esto: la promesa de esos íconos es que la misma imagen
 * identifica a la misma sección en el menú, en Buscar y en su pantalla, y
 * prestado rompería esa correspondencia en tres lugares a la vez.
 *
 * Cuando llegue `comunidad.webp`, esta cabecera se reemplaza por
 * `<SectionHeading image="/icons/menu/comunidad.webp" …>` y este archivo se
 * borra. No hay nada más que migrar: los tamaños y el ritmo son los mismos.
 */
export function ComunidadHeading({
  icon,
  title,
  subtitle,
  as: Tag = "h1",
  className,
}: ComunidadHeadingProps) {
  return (
    <Bubble
      accent={COMUNIDAD_ACCENT}
      tone="accentSoft"
      shape="tile"
      size="none"
      className={cn("flex items-center gap-3 p-3", className)}
    >
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-md bg-[var(--bubble-wash)] text-[var(--bubble-ink)]"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <Tag className="font-display text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">
          {title}
        </Tag>
        {subtitle && (
          <span className="mt-0.5 block text-sm leading-snug text-foreground-secondary">
            {subtitle}
          </span>
        )}
      </span>
    </Bubble>
  );
}
