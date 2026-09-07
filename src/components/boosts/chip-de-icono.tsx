import type { Icon } from "@phosphor-icons/react";

/**
 * Ícono en pastilla redonda tintada al 14% del acento — el mismo lenguaje
 * visual que `TileIconChip` del menú del "+" y que `AccentLink`.
 *
 * Se redeclara acá en vez de importarse de `components/shell/create-menu.tsx`
 * porque aquel archivo es `"use client"`: importarlo desde una RSC arrastraría
 * el menú entero (y su `COPY` del feed) al bundle del cliente para reusar
 * catorce líneas de JSX sin estado.
 *
 * El tinte va por `style` y no por una clase de Tailwind porque el acento es
 * una custom property distinta por opción (`var(--accent-*)`), y `color-mix`
 * sobre una variable no se puede precompilar a utilities.
 */
export function ChipDeIcono({
  accent,
  Icon: IconoDeLaOpcion,
  size = 44,
}: {
  accent: string;
  Icon: Icon;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        backgroundColor: `color-mix(in oklab, ${accent} 14%, transparent)`,
        color: accent,
      }}
      className="flex shrink-0 items-center justify-center rounded-full"
    >
      <IconoDeLaOpcion size={Math.round(size * 0.5)} weight="bold" />
    </span>
  );
}
