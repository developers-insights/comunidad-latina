import type { ReactNode } from "react";
import { SectionTopBar } from "@/components/shell";

/**
 * Candidatos de un aviso de empleo — la salida de la pantalla.
 *
 * El fallback se arma con el parámetro de la ruta (los layouts reciben `params`
 * igual que las páginas), así quien abre esto desde un link vuelve a el aviso,
 * que es de donde se entra. Vive en un layout y no en la página para cubrir
 * también las ramas que la página devuelve antes de su contenido (sin permiso,
 * no encontrado). Ver `components/shell/section-top-bar.tsx`.
 */
export default async function CandidatosLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <SectionTopBar fallbackHref={`/empleos/${encodeURIComponent(id)}`} />
      {children}
    </>
  );
}
