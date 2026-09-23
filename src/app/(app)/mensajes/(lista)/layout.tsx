import type { ReactNode } from "react";
import { SectionTopBar } from "@/components/shell";

/**
 * Mensajes › Personas — la salida de la bandeja (pedido de Nacho, 22/9: «falta
 * botón de volver atrás»). Grupos y Solicitudes ya la tenían; Personas, que es
 * la pestaña por la que se entra, no.
 *
 * Va en el layout y no en la página para que también esté mientras carga el
 * `loading.tsx`: si apareciera recién con la lista, todo saltaría 48px.
 *
 * Fallback al feed: a la bandeja se llega desde el ícono del header, que está
 * en todas las pantallas, así que no hay un "padre" de la experiencia más
 * cercano que el inicio.
 */
export default function MensajesListaLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTopBar fallbackHref="/feed" />
      {children}
    </>
  );
}
