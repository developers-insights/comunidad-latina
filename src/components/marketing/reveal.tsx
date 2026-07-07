"use client";

import type { ReactNode } from "react";
import { Reveal as MotionReveal } from "@/components/motion";

/**
 * Reveal de la landing (§2.7). Antes tenía su propia implementación con framer;
 * ahora delega en el primitivo canónico `@/components/motion` (IntersectionObserver
 * + CSS, sin framer) para no duplicar la lógica de reveal en el repo.
 *
 * Se mantiene la firma histórica de la landing: `delay` en SEGUNDOS (para no tocar
 * los ~20 call sites `delay={0.08}`). Acá lo convertimos a los milisegundos que
 * espera el primitivo. prefers-reduced-motion ya está resuelto adentro (aparece
 * estático, sin animar) y el contenido va en el DOM desde el server → no hunde el LCP.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Segundos de delay para escalonar tarjetas hermanas (firma histórica). */
  delay?: number;
  className?: string;
}) {
  return (
    <MotionReveal delay={Math.round(delay * 1000)} y={24} className={className}>
      {children}
    </MotionReveal>
  );
}
