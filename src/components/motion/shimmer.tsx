"use client";

import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import styles from "./motion.module.css";

export type ShimmerProps = {
  children: React.ReactNode;
  /** Desactiva el barrido (ej. cuando el elemento pierde relevancia). */
  disabled?: boolean;
  as?: "div" | "span";
  className?: string;
};

/**
 * Barrido de brillo sutil y periódico sobre su contenido — para destacar un badge/pill
 * premium sin gritarlo. NO es el skeleton (para eso está <Skeleton> de ui/).
 *
 * - Reduced-motion o `disabled`: no barre; renderiza el contenido tal cual.
 * - `aria-hidden` sobre el sheen; el contenido queda accesible normal.
 *
 * @example
 * <Shimmer className="rounded-full bg-brand px-3 py-1 text-brand-foreground">
 *   Premium
 * </Shimmer>
 */
export function Shimmer({ children, disabled = false, as = "span", className }: ShimmerProps) {
  const reduce = usePrefersReducedMotion();
  const Tag = as as "span";
  const on = !reduce && !disabled;
  return (
    <Tag className={cn(on && styles.shimmerSheen, className)}>{children}</Tag>
  );
}
