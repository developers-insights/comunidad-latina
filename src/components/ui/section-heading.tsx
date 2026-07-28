import { cn } from "@/lib/utils";
import { Bubble } from "./bubble";

export interface SectionHeadingProps {
  /** Acento del módulo (`var(--accent-negocios)`), nunca un color crudo. */
  accent: string;
  /** Ícono 3D del set del menú (`/icons/menu/negocios.webp`). Decorativo. */
  image: string;
  title: string;
  subtitle?: string;
  /** `h1` en la página de la sección; `h2` si algún día se anida. */
  as?: "h1" | "h2";
  className?: string;
}

/**
 * Cabecera de sección en cápsula (feedback cliente 2026-07-27: «aquí está todo
 * suelto… se ve estético cuando está en su pastilla»).
 *
 * Antes: título y bajada sueltos sobre la plancha blanca, con un botoncito gris
 * de "Publicar" arriba a la derecha. Ahora el bloque entero es UN objeto —
 * relleno tintado del módulo, hairline del mismo acento y el ícono 3D que ya
 * identifica a la sección en el menú y en Buscar. La misma imagen en los tres
 * lugares es lo que hace que la persona reconozca dónde está sin leer.
 *
 * El botón de publicar se fue de acá a propósito: vive en su propia burbuja
 * (SectionCta), que es lo que pidió el cliente.
 */
export function SectionHeading({
  accent,
  image,
  title,
  subtitle,
  as: Tag = "h1",
  className,
}: SectionHeadingProps) {
  return (
    <Bubble
      accent={accent}
      // `soft`: la cabecera INFORMA. El CTA que va debajo usa `strong` y por eso
      // se distingue como el elemento que se toca — si los dos llevaran el mismo
      // tinte, el bloque entero se leería como una sola mancha de color.
      tone="accentSoft"
      shape="tile"
      size="none"
      className={cn("flex items-center gap-3 p-3", className)}
    >
      {/* Radio concéntrico: 28px del tile − 12px de padding = 16px (radius-md).
          El asset trae su propio fondo pastel del acento, así que va a sangre. */}
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--bubble-wash)]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ícono decorativo local de 320px, sin impacto LCP */}
        <img src={image} alt="" width={56} height={56} className="size-full object-cover" />
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
