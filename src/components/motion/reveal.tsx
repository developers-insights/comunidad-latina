"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

export type RevealProps = {
  children: React.ReactNode;
  /** Retraso en ms (para stagger manual). Default 0. */
  delay?: number;
  /** Desplazamiento vertical inicial en px. Default 16. */
  y?: number;
  /** Sólo una vez (no re-oculta al salir). Default true. */
  once?: boolean;
  /** Etiqueta HTML. Default "div". */
  as?: "div" | "section" | "li" | "article" | "span";
  className?: string;
};

/**
 * Fade + translateY corto al entrar en viewport. LIVIANO: sólo IntersectionObserver + CSS
 * (sin framer). Para secciones de landing y cards.
 *
 * - Reduced-motion: aparece sin animar (visible desde el arranque, sin transición).
 * - No bloquea el LCP: el contenido está en el DOM; sólo se transiciona opacity/transform.
 *
 * Para stagger automático de una lista, usá <RevealGroup>.
 *
 * @example
 * <Reveal><Card /></Reveal>
 * <Reveal delay={80} y={24}><h2>…</h2></Reveal>
 */
export function Reveal({
  children,
  delay = 0,
  y = 16,
  once = true,
  as = "div",
  className,
}: RevealProps) {
  const reduce = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  const Tag = as as "div";

  useEffect(() => {
    // Reduced-motion no anima: la visibilidad se resuelve por estilo (abajo), sin estado.
    if (reduce) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      // Sin IO no podemos detectar el viewport: mostramos en el próximo frame.
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            if (once) io.disconnect();
          } else if (!once) {
            setShown(false);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reduce, once]);

  const visible = reduce || shown;
  const style: React.CSSProperties = reduce
    ? {}
    : {
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : `translateY(${y}px)`,
        transition:
          "opacity var(--duration-slow) var(--ease-out-premium), transform var(--duration-slow) var(--ease-out-premium)",
        transitionDelay: shown ? `${delay}ms` : "0ms",
        willChange: shown ? "auto" : "opacity, transform",
      };

  return (
    <Tag ref={ref as never} className={cn(className)} style={style}>
      {children}
    </Tag>
  );
}

export type RevealGroupProps = {
  children: React.ReactNode;
  /** ms entre cada hijo. Default 70. */
  stagger?: number;
  /** delay base antes del primer hijo. Default 0. */
  baseDelay?: number;
  y?: number;
  as?: "div" | "section" | "ul" | "ol";
  className?: string;
};

/**
 * Revela sus hijos directos con stagger. Cada hijo hereda un delay incremental.
 *
 * @example
 * <RevealGroup className="grid gap-4">
 *   {items.map((it) => <Card key={it.id} {...it} />)}
 * </RevealGroup>
 */
export function RevealGroup({
  children,
  stagger = 70,
  baseDelay = 0,
  y = 16,
  as = "div",
  className,
}: RevealGroupProps) {
  const items = Array.isArray(children) ? children : [children];
  const Tag = as as "div";
  return (
    <Tag className={cn(className)}>
      {items.map((child, i) => (
        <Reveal key={i} delay={baseDelay + i * stagger} y={y}>
          {child}
        </Reveal>
      ))}
    </Tag>
  );
}
