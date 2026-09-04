import type { ReactNode } from "react";
import { SectionTopBar } from "@/components/shell";

/**
 * Presencia de un aviso — la salida de la pantalla.
 *
 * El fallback se arma con el parámetro de la ruta (los layouts reciben `params`
 * igual que las páginas), así quien abre esto desde un link vuelve a la pantalla de promoción del aviso,
 * que es de donde se entra. Vive en un layout y no en la página para cubrir
 * también las ramas que la página devuelve antes de su contenido (sin permiso,
 * no encontrado). Ver `components/shell/section-top-bar.tsx`.
 */
export default async function PresenciaAvisoLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;

  return (
    <>
      <SectionTopBar fallbackHref={`/impulsar/${encodeURIComponent(listingId)}`} />
      {children}
    </>
  );
}
