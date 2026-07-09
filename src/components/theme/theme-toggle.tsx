"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "./use-theme";

const COPY = {
  /**
   * El NOMBRE accesible es la ACCIÓN, no el estado. Antes de montar no sabemos
   * el tema, así que el nombre no puede prometer un destino: "Cambiar el tema"
   * es verdad en los tres casos.
   */
  toggleUnknown: "Cambiar el tema",
  toDark: "Cambiar a tema oscuro",
  toLight: "Cambiar a tema claro",
  /**
   * La DESCRIPCIÓN dice en qué tema estás y —lo que `aria-pressed` no podía
   * decir— quién lo eligió: el SO (estado inicial) o vos.
   */
  stateSystemDark: "Ahora seguís el tema oscuro del sistema.",
  stateSystemLight: "Ahora seguís el tema claro del sistema.",
  stateDark: "Elegiste el tema oscuro.",
  stateLight: "Elegiste el tema claro.",
} as const;

/** Los dos botones son gemelos: 44×44 (§3.2) y el mismo tratamiento de foco. */
const BUTTON_CLASS = cn(
  "flex size-11 shrink-0 items-center justify-center rounded-full",
  "text-foreground-secondary transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
  "hover:bg-surface-hover hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

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
 * Control de tema. Sol↔luna con un tap: claro↔oscuro. La primera elección deja
 * de seguir al SO y persiste; no hay vuelta a `system` desde la UI (patrón
 * habitual de un toggle claro/oscuro).
 *
 * ── Por qué NO es un toggle button ─────────────────────────────────────────
 * `aria-pressed` describe el estado binario PROPIO del control. La preferencia
 * de tema es ternaria (`light | dark | system`): antes de la primera elección
 * el estado es `system`, así que `aria-pressed={isDark}` mentía — con el SO en
 * oscuro el lector cantaba "Tema oscuro, activado" sobre una elección que el
 * usuario nunca hizo. `aria-pressed="mixed"` tampoco sirve: la spec lo define
 * como "parcialmente presionado" y `system` no es medio oscuro.
 *
 * Un botón sin estado binario propio es un botón a secas. Entonces:
 *   · NOMBRE      = la acción ("Cambiar a tema claro"). Cambia al activarlo, y
 *                   los lectores anuncian el nombre nuevo del control enfocado:
 *                   es el reemplazo canónico de `aria-pressed`, sin live region
 *                   (una live region acá anunciaría de más en cada carga).
 *   · DESCRIPCIÓN = de dónde viene el tema ("Ahora seguís el tema oscuro del
 *                   sistema." antes de elegir / "Elegiste el tema oscuro."
 *                   después). `aria-describedby` sobre un <span class="sr-only">,
 *                   no `title`: el title no existe en touch y lo pisa cualquier
 *                   descripción real.
 * Nada se afirma antes de montar: en el HTML del server no hay ni estado ni
 * promesa de destino (`resolvedTheme === null` ⇒ nombre neutro, sin descripción).
 *
 * ── El morph, sin React ────────────────────────────────────────────────────
 * Todo el morph se deriva de `--cl-theme-dark` (0 = sol, 1 = luna), la variable
 * que globals.css voltea junto con la paleta y que el script pre-paint deja en
 * su valor correcto antes del primer paint. Por eso el ícono nunca "salta" al
 * hidratar, ni siquiera sin JS.
 *
 * El morph: los rayos se retraen (escalan a 0.55 y rotan -75°) mientras el disco
 * crece 22% y una máscara circular entra desde arriba-derecha y le muerde el
 * borde hasta dejar una luna creciente. Todo con `calc()` sobre esa única
 * variable, interpolada por `@property` (globals.css).
 *
 * `prefers-reduced-motion` ya está cubierto globalmente (globals.css fuerza
 * `transition-duration: 0.01ms !important`): el ícono cambia sin animar.
 *
 * No usa @phosphor-icons para el sol/luna a propósito: Sun y Moon son dos paths
 * distintos, no morphean; cross-fadearlos se ve barato.
 *
 * `className` va al contenedor: los call sites sólo le pasan posicionamiento.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, toggle } = useTheme();
  const rawId = useId();
  // useId mete caracteres que no son válidos en un id de SVG referenciado por url().
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const maskId = `cl-moon-${safeId}`;
  const stateId = `cl-theme-state-${safeId}`;

  // `null` = todavía no montó: el server no puede saber el tema del usuario.
  const mounted = resolvedTheme !== null;
  const isDark = resolvedTheme === "dark";
  const followsSystem = theme === "system";

  const action = !mounted ? COPY.toggleUnknown : isDark ? COPY.toLight : COPY.toDark;

  let stateText: string | null = null;
  if (mounted) {
    if (followsSystem) stateText = isDark ? COPY.stateSystemDark : COPY.stateSystemLight;
    else stateText = isDark ? COPY.stateDark : COPY.stateLight;
  }

  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-label={action}
        // `title` idéntico al nombre: si difirieran, el lector diría una cosa y
        // el tooltip mostraría otra. La descripción real va por `aria-describedby`,
        // que además le gana al title cuando los dos están presentes — y por eso
        // el title sólo se monta cuando hay `aria-describedby` que lo suprima. En
        // el HTML del server no hay descripción todavía: ahí el title se repetiría
        // como descripción, y un tooltip sobre un botón sin JS no le sirve a nadie.
        title={stateText === null ? undefined : action}
        aria-describedby={stateText === null ? undefined : stateId}
        className={BUTTON_CLASS}
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

      {stateText === null ? null : (
        <span id={stateId} className="sr-only">
          {stateText}
        </span>
      )}
    </div>
  );
}
