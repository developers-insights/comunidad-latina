"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

type TapScaleOwnProps = {
  /** Escala al presionar. Default 0.97 (el patrón premium de botón nativo). */
  scale?: number;
  /** Desactiva el feedback (ej. estado disabled/loading). */
  disabled?: boolean;
  /** Etiqueta HTML a renderizar. Default "button". Usa "span"/"div" para tocables no-botón. */
  as?: "button" | "span" | "div" | "a";
};

export type TapScaleProps = TapScaleOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof TapScaleOwnProps> & {
    href?: string;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
  };

/**
 * Wrapper de feedback de tap con spring (§5.1): `active:scale-[0.97]` en <100ms
 * con `--ease-spring`. El patrón que hace que cualquier tocable se sienta nativo/caro.
 *
 * - Reduced-motion: sin escala (queda el resto de estilos intactos).
 * - No impone estilos visuales: es puramente el juice del press. Componelo con tus clases.
 * - Accesible por herencia: renderiza el elemento que le pidas (button/a/…), no atrapa foco
 *   ni teclado; los handlers y aria-* pasan por props.
 *
 * @example
 * <TapScale className="rounded-full bg-brand px-5 py-2 text-brand-foreground" onClick={fn}>
 *   Seguir
 * </TapScale>
 */
export const TapScale = forwardRef<HTMLElement, TapScaleProps>(function TapScale(
  { as = "button", scale = 0.97, disabled = false, type, className, style, children, ...props },
  ref,
) {
  const reduce = usePrefersReducedMotion();
  const Tag = as as "button";

  const motionStyle: React.CSSProperties =
    reduce || disabled
      ? { ...style }
      : {
          transitionProperty: "transform",
          transitionDuration: "var(--duration-instant)",
          transitionTimingFunction: "var(--ease-spring)",
          ["--tap-scale" as string]: String(scale),
          ...style,
        };

  return (
    <Tag
      ref={ref as never}
      className={cn(
        "select-none",
        !reduce && !disabled && "active:[transform:scale(var(--tap-scale))]",
        className,
      )}
      style={motionStyle}
      aria-disabled={disabled || undefined}
      {...(as === "button" ? { type: type ?? "button", disabled } : {})}
      {...props}
    >
      {children}
    </Tag>
  );
});
