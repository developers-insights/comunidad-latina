import type { ReactNode } from "react";
import { SectionTopBar } from "@/components/shell";

/**
 * Mensajes › Solicitudes — la salida de la pantalla.
 *
 * El fallback vuelve a `/mensajes` y no al historial: a esta pantalla se llega
 * casi siempre desde una notificación, y ahí el "atrás" del navegador sale de
 * la app entera. En la PWA instalada no hay barra del navegador que salve la
 * situación. Ver `components/shell/section-top-bar.tsx`.
 */
export default function SolicitudesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTopBar fallbackHref="/mensajes" />
      {children}
    </>
  );
}
