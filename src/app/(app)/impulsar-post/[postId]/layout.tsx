import type { ReactNode } from "react";
import { SectionTopBar } from "@/components/shell";

/**
 * Impulsar una publicación — la salida de la pantalla.
 *
 * Quedó fuera de la tanda inicial de barras (feedback 2026-09-03, punto 3)
 * porque este módulo se estaba tocando en paralelo. Misma regla que el resto:
 * vive en un layout para cubrir también las ramas sin sesión / sin permiso /
 * no encontrado. Volver retrocede si hay historial de la app; si se entró
 * directo, cae al feed, que es de donde se llega a impulsar una publicación.
 * Ver `components/shell/section-top-bar.tsx`.
 */
export default function ImpulsarPostLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTopBar fallbackHref="/feed" />
      {children}
    </>
  );
}
