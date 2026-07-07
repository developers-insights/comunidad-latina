"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

/**
 * TRANSICIÓN DE PÁGINA (§ polish premium — módulo SPLASH + TRANSICIONES).
 *
 * Se monta desde un `template.tsx` (no un layout): Next re-instancia el
 * template en cada navegación, así que SOLO el contenido de la página cruza
 * el fade — el Header y el BottomNav viven en el LAYOUT, que persiste y por
 * tanto NO parpadea entre rutas.
 *
 * Fade + translateY corto con --ease-out-premium / --duration-base. La `key`
 * por pathname fuerza el remonte-animado incluso en navegaciones entre rutas
 * del mismo segmento dinámico.
 *
 * prefers-reduced-motion: renderiza el contenido tal cual, sin motion alguno.
 *
 * Nota técnica (Next 16): se prefirió esta técnica sobre la View Transitions
 * API nativa porque `unstable_ViewTransition` exige el flag experimental en
 * next.config (propiedad del módulo PWA — no se toca) y el build de prod corre
 * con `--webpack`; el template + motion es estable, cero config y respeta el
 * ownership disjunto.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const pathname = usePathname();

  if (reduceMotion) {
    return <>{children}</>;
  }

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      // will-change acotado al frame de animación evita capas persistentes
      // que arruinen el scroll/paint del contenido ya asentado.
      style={{ willChange: "opacity, transform" }}
    >
      {children}
    </motion.div>
  );
}
