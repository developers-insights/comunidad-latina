"use client";

import { Flag } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

/**
 * "Reportar como estafa" — SIEMPRE en la misma posición relativa en las
 * 12+ superficies donde aplica (primera opción del menú de acciones, §3.3).
 * La consistencia posicional es en sí misma una señal de seguridad.
 */
export interface ReportScamButtonProps {
  /** El caller resuelve el flujo (confirmación + server action). */
  onReport: () => void;
  /**
   * menu-item: primera fila de un menú "⋯" (default).
   * button: botón standalone en una pantalla de detalle.
   */
  variant?: "menu-item" | "button";
  className?: string;
}

export function ReportScamButton({
  onReport,
  variant = "menu-item",
  className,
}: ReportScamButtonProps) {
  return (
    <button
      type="button"
      onClick={onReport}
      aria-label="Reportar como estafa"
      className={cn(
        "select-none font-medium text-danger transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.98]",
        variant === "menu-item"
          ? "flex min-h-11 w-full items-center gap-2.5 px-4 py-3 text-left text-sm hover:bg-danger-bg"
          : "inline-flex h-11 items-center gap-2 rounded-md bg-danger-bg px-5 text-sm hover:bg-danger/15",
        className,
      )}
    >
      <Flag size={18} aria-hidden="true" className="shrink-0" />
      Reportar como estafa
    </button>
  );
}
