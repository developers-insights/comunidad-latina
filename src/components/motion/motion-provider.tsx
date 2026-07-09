"use client";

import { LazyMotion, domMax } from "motion/react";
import type { ReactNode } from "react";

/**
 * Un único proveedor de features de motion para toda la app.
 *
 * `m` (la API que usa el resto del árbol) es un componente mínimo (~4-5KB); las
 * features de animación se cargan ASYNC acá vía LazyMotion → quedan FUERA del
 * first-load JS síncrono (incluida la pantalla de login /entrar). Antes, importar
 * el `motion` completo desde el root layout (ToastProvider + SplashScreen) metía
 * el motor entero (~25-35KB gzip) en el bundle inicial de toda ruta.
 *
 * `domMax` incluye layout animations (layoutId en tabs/admin-nav) y drag
 * (bottom-sheet) — `domAnimation` NO las cubre. `strict` prohíbe `motion.*`
 * (obliga `m.*`) para que nada vuelva a bundlear el motor completo por accidente.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      {children}
    </LazyMotion>
  );
}
