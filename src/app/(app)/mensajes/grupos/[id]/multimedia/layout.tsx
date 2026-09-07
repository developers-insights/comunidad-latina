import type { ReactNode } from "react";
import { SectionTopBar } from "@/components/shell";

/**
 * Grupo › Archivos y enlaces — la salida.
 *
 * El fallback es la INFO del grupo y no el chat: acá se llega desde ahí, y
 * quien abre la pantalla por un enlace directo espera volver al lugar donde
 * esta sección tiene sentido. Ver `components/shell/section-top-bar.tsx`.
 */
export default async function GaleriaLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <SectionTopBar fallbackHref={`/mensajes/grupos/${encodeURIComponent(id)}/info`} />
      {children}
    </>
  );
}
