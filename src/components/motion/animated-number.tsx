"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

export type AnimatedNumberProps = {
  /** Valor destino. */
  value: number;
  /** Duración del conteo en ms. Default 700 (~--duration-slow+). */
  duration?: number;
  /** Decimales a mostrar. Default 0. */
  decimals?: number;
  /** Formateador custom (ej. formatMoney). Recibe el valor intermedio. */
  format?: (n: number) => string;
  /** Sólo animar cuando entra en viewport (para contadores below-the-fold). Default false. */
  startOnView?: boolean;
  /**
   * Suprime la región aria-live interna. Usar cuando un ancestro ya rotula el valor
   * (ej. el aria-label del TrustScoreBadge): el número queda puramente visual.
   */
  silent?: boolean;
  className?: string;
};

const easeOutPremium = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * Número que cuenta hasta su valor con `tabular-nums` (no salta ancho) y curva premium.
 * Para Trust Score, precios y contadores.
 *
 * - Reduced-motion: salta directo al valor final, sin tween.
 * - El número visible es `aria-hidden`; un hermano sr-only con `aria-live="polite"`
 *   anuncia SÓLO el valor final (`value`), no los frames intermedios del tween.
 *   Con `silent` no se emite ninguna región aria-live (el ancestro ya rotula).
 * - Re-anima suavemente cuando `value` cambia (desde el valor anterior).
 *
 * @example
 * <AnimatedNumber value={4820} format={(n) => formatMoney(n)} />
 * <AnimatedNumber value={87} startOnView />
 */
export function AnimatedNumber({
  value,
  duration = 700,
  decimals = 0,
  format,
  startOnView = false,
  silent = false,
  className,
}: AnimatedNumberProps) {
  const reduce = usePrefersReducedMotion();
  // SSR/primer render: mostramos el valor final (sin flash, LCP sano). El tween arranca
  // en el cliente cuando corresponde.
  const [display, setDisplay] = useState<number>(value);
  const [armed, setArmed] = useState<boolean>(!startOnView);
  const fromRef = useRef<number>(value);
  const rafRef = useRef<number | null>(null);
  const nodeRef = useRef<HTMLSpanElement | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!startOnView || armed) return;
    const node = nodeRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setArmed(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArmed(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [startOnView, armed]);

  useEffect(() => {
    if (!armed) return;
    if (reduce) {
      // Sin animación: fijamos el valor final en el próximo frame (no en el cuerpo del efecto).
      fromRef.current = value;
      const id = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(id);
    }
    // Primer tween: contar desde 0. Cambios posteriores de `value`: desde el valor previo.
    const from = mountedRef.current ? fromRef.current : 0;
    mountedRef.current = true;
    const to = value;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutPremium(t);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    // La primera llamada a setDisplay ocurre dentro del rAF (asíncrona), evitando el
    // salto visible del mount: el frame 0 ya pinta `from`.
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, reduce, armed, startOnView]);

  const rounded =
    decimals > 0 ? Number(display.toFixed(decimals)) : Math.round(display);
  const text = format ? format(rounded) : rounded.toLocaleString("es-US");
  // Valor accesible: el DESTINO final, redondeado igual que el visual. No depende
  // del tween, así el lector anuncia un único valor, no cada frame.
  const finalRounded =
    decimals > 0 ? Number(value.toFixed(decimals)) : Math.round(value);
  const finalText = format
    ? format(finalRounded)
    : finalRounded.toLocaleString("es-US");

  return (
    <span ref={nodeRef} className={cn("tabular-nums", className)}>
      <span aria-hidden="true">{text}</span>
      {!silent && (
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {finalText}
        </span>
      )}
    </span>
  );
}
