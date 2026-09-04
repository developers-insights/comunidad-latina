import type { ReactNode } from "react";
import { SectionTopBar } from "@/components/shell";

/**
 * Grupo › Info — la salida de la pantalla.
 *
 * El fallback se arma con el id del grupo (los layouts reciben `params` igual
 * que las páginas): quien abre esto desde un link vuelve AL GRUPO, no a la
 * lista. Ver `components/shell/section-top-bar.tsx`.
 */
export default async function GrupoLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <SectionTopBar fallbackHref={`/mensajes/grupos/${encodeURIComponent(id)}`} />
      {children}
    </>
  );
}
