"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * TRANSICIÓN DE PÁGINA (§ polish premium — módulo SPLASH + TRANSICIONES).
 *
 * Se monta desde un `template.tsx` (no un layout): Next re-instancia el
 * template en cada navegación, así que SOLO el contenido de la página cruza
 * el fade — el Header y el BottomNav viven en el LAYOUT, que persiste y por
 * tanto NO parpadea entre rutas.
 *
 * 100% CSS (antes usaba `motion`): fade + translateY corto vía @keyframes
 * `cl-page-in` en globals.css. El `key` por pathname re-monta el nodo y
 * re-dispara la animación en cada navegación — idéntico comportamiento, pero
 * SIN cargar ni ejecutar JS de motion en cada transición (es la animación más
 * frecuente de la app). prefers-reduced-motion se respeta en globals.css (la
 * animación solo aplica con `no-preference`).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="cl-page-transition">
      {children}
    </div>
  );
}
