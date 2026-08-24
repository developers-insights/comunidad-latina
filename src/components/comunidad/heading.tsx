import type { ReactNode } from "react";
import { Bubble } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Acento del módulo (globals.css). Una sola constante para todo Comunidad. */
export const COMUNIDAD_ACCENT = "var(--accent-comunidad)";

/**
 * Sub-acentos de la grilla de categorías de la portada (0099, rediseño
 * 2026-08-13). Nombradas acá y no como strings sueltos en `(indice)/page.tsx`
 * por lo mismo que ya vale para `COMUNIDAD_ACCENT`: un typo en
 * `"var(--accent-comunidad-comida)"` escrito a mano no lo agarra TypeScript,
 * una constante mal importada sí. "Pedir ayuda" no tiene la suya: reusa
 * `COMUNIDAD_ACCENT` a propósito (ver el comentario de la portada).
 */
export const COMUNIDAD_ACCENT_GUIAS = "var(--accent-comunidad-guias)";
export const COMUNIDAD_ACCENT_PERDIDOS = "var(--accent-comunidad-perdidos)";
export const COMUNIDAD_ACCENT_COMIDA = "var(--accent-comunidad-comida)";
export const COMUNIDAD_ACCENT_VOLUNTARIOS = "var(--accent-comunidad-voluntarios)";
/**
 * Acopio (0105) — sexto sub-acento, fucsia-700, elegido por ser el que más se
 * separa en matiz de los otros cinco de ESTA grilla (index/page.tsx): a
 * ~50-60° de cada vecino, contra ~50° del par más ajustado que ya conviven
 * hoy (ámbar/rosa). Es la MISMA convención que sus hermanas (un tono "700" de
 * la paleta, fijo con el tema, nunca theming).
 *
 * `--accent-comunidad-acopio` se declara en `globals.css` junto a las otras
 * cinco, igual que ellas y sin excepciones.
 */
export const COMUNIDAD_ACCENT_ACOPIO = "var(--accent-comunidad-acopio)";

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
 * un ícono Phosphor (mano + corazón) en vez del render 3D del set del menú.
 * No es una solución provisoria: el cliente confirmó (13/8/2026) que este
 * ícono está bien así, en las tres superficies (menú, Buscar y esta pantalla)
 * — `modules.ts` no lleva `image` para Comunidad a propósito, y las tres
 * caen al mismo Phosphor por el mismo motivo.
 *
 * Si algún día se suma un ícono 3D (`/public/icons/menu/comunidad.webp`), esta
 * cabecera se reemplaza por `<SectionHeading image="…" …>` y este archivo se
 * borra — no hay nada más que migrar, los tamaños y el ritmo son los mismos.
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
