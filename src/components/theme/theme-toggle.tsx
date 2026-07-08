"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "./use-theme";

const COPY = {
  /** Nombre accesible estable + aria-pressed = patrón de botón de alternancia. */
  label: "Tema oscuro",
  toDark: "Cambiar a tema oscuro",
  toLight: "Volver al tema claro",
} as const;

/* ── Geometría del sol (8 rayos a 45°, radio 8.2 → 10.6, centro 12,12) ── */
const RAYS: ReadonlyArray<readonly [number, number, number, number]> = [
  [20.2, 12, 22.6, 12],
  [17.8, 17.8, 19.5, 19.5],
  [12, 20.2, 12, 22.6],
  [6.2, 17.8, 4.5, 19.5],
  [3.8, 12, 1.4, 12],
  [6.2, 6.2, 4.5, 4.5],
  [12, 3.8, 12, 1.4],
  [17.8, 6.2, 19.5, 4.5],
];

/**
 * Botón sol↔luna. 44×44 (§3.2), `aria-pressed` = "el tema oscuro está activo".
 *
 * La animación NO depende de React: todo el morph se deriva de `--cl-theme-dark`
 * (0 = sol, 1 = luna), la variable que globals.css voltea junto con la paleta y
 * que el script pre-paint deja en su valor correcto antes del primer paint. Por
 * eso el ícono nunca "salta" al hidratar, ni siquiera sin JS.
 *
 * El morph: los rayos se retraen (escalan a 0.55 y rotan -75°) mientras el disco
 * crece 22% y una máscara circular entra desde arriba-derecha y le muerde el
 * borde hasta dejar una luna creciente. Todo con `calc()` sobre esa única
 * variable, interpolada por `@property` (globals.css).
 *
 * `prefers-reduced-motion` ya está cubierto globalmente (globals.css fuerza
 * `transition-duration: 0.01ms !important`): el ícono cambia sin animar.
 *
 * No usa @phosphor-icons a propósito: Sun y Moon son dos paths distintos, no
 * morphean; cross-fadearlos se ve barato.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggle } = useTheme();
  const rawId = useId();
  // useId mete caracteres que no son válidos en un id de SVG referenciado por url().
  const maskId = `cl-moon-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // `null` = todavía no montó: el server no puede saber el tema del usuario.
  const mounted = resolvedTheme !== null;
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={COPY.label}
      aria-pressed={mounted ? isDark : undefined}
      title={mounted ? (isDark ? COPY.toLight : COPY.toDark) : undefined}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full",
        "text-foreground-secondary transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
        "hover:bg-surface-hover hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
        // La transición vive sobre la variable: los hijos heredan el valor ya
        // interpolado y sus calc() se recalculan solos, frame a frame.
        style={{ transition: "--cl-theme-dark var(--duration-base) var(--ease-spring)" }}
      >
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          {/* blanco = se ve, negro = se recorta (luminancia, no theming) */}
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <circle
            cx="25.5"
            cy="3"
            r="8.5"
            fill="black"
            style={{
              transform:
                "translate(calc(var(--cl-theme-dark) * -8.7px), calc(var(--cl-theme-dark) * 4.2px))",
            }}
          />
        </mask>

        <circle
          cx="12"
          cy="12"
          r="5"
          fill="currentColor"
          mask={`url(#${maskId})`}
          style={{
            transformOrigin: "12px 12px",
            transform: "scale(calc(1 + 0.22 * var(--cl-theme-dark)))",
          }}
        />

        <g
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          style={{
            transformOrigin: "12px 12px",
            transform:
              "rotate(calc(var(--cl-theme-dark) * -75deg)) scale(calc(1 - 0.45 * var(--cl-theme-dark)))",
            opacity: "calc(1 - var(--cl-theme-dark))",
          }}
        >
          {RAYS.map(([x1, y1, x2, y2]) => (
            <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </g>
      </svg>
    </button>
  );
}
