import type { ReactNode } from "react";
import { SectionTopBar } from "@/components/shell";

/**
 * Formulario: ofrecer un espacio — la salida de la pantalla.
 *
 * Vive en un layout y no adentro de la página para que la barra esté también en
 * las ramas que la página devuelve antes de su contenido (sin sesión, sin
 * permiso, no encontrado) y mientras el contenido carga. Volver retrocede si hay
 * historial de la app detrás y, si no, cae a `/comunidad/espacio`.
 * Ver `components/shell/section-top-bar.tsx`.
 */
export default function OfrecerEspacioLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTopBar fallbackHref="/comunidad/espacio" />
      {children}
    </>
  );
}
