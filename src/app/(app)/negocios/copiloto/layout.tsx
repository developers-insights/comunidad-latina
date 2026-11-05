import type { ReactNode } from "react";
import { SectionTopBar } from "@/components/shell";
import { exigirSesion } from "@/lib/auth/exigir-sesion";

/**
 * Copiloto del negocio — la salida de la pantalla.
 *
 * Vive en un layout y no adentro de la página para que la barra esté también en
 * las ramas que la página devuelve antes de su contenido (sin sesión, sin
 * permiso, no encontrado) y mientras el contenido carga. Volver retrocede si hay
 * historial de la app detrás y, si no, cae a `/negocios`.
 * Ver `components/shell/section-top-bar.tsx`.
 */
export default async function CopilotoLayout({ children }: { children: ReactNode }) {
  await exigirSesion("/negocios/copiloto");

  return (
    <>
      <SectionTopBar fallbackHref="/negocios" />
      {children}
    </>
  );
}
