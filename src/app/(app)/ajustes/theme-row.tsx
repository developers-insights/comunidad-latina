"use client";

import { ThemeIcon, useThemeToggleLabel } from "@/components/theme";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/**
 * Fila "Tema" de Ajustes: el botón es TODA la fila, no sólo el sol/luna
 * (feedback cliente 2026-07-20 — no hacía falta acertarle al ícono). Venía del
 * menú lateral y se mudó acá cuando ese menú se eliminó.
 *
 * El ícono es decorativo a propósito: `ThemeIcon` no trae botón propio porque
 * HTML no permite anidar botones (ver theme-toggle.tsx). El nombre accesible es
 * la ACCIÓN ("Cambiar a tema oscuro") y el estado va aparte, en `aria-describedby`.
 */
export function ThemeRow({ className }: { className?: string }) {
  const { action, stateText, stateId, toggle } = useThemeToggleLabel();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`${COPY.rows.theme.title}: ${action}`}
      title={stateText === null ? undefined : action}
      // El estado NO se repite en un `sr-only`: acá es texto visible, así que
      // `aria-describedby` apunta a ese mismo nodo. Con `aria-label` puesto, el
      // contenido del botón no entra en su nombre, y sin esta referencia quien
      // escucha la pantalla se perdería en qué tema está.
      aria-describedby={stateId}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 px-3 text-left",
        "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
        className,
      )}
    >
      <ThemeIcon className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {COPY.rows.theme.title}
        </span>
        <span id={stateId} className="block text-xs text-foreground-secondary">
          {/* Antes de montar no sabemos el tema (el server no puede saberlo):
              hasta entonces, la descripción genérica. */}
          {stateText ?? COPY.rows.theme.description}
        </span>
      </span>
    </button>
  );
}
