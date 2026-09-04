import type { ReactNode } from "react";
import { SectionTopBar } from "@/components/shell";

/**
 * Subpantalla de Impulsar un aviso — la salida de la pantalla (feedback
 * 2026-09-03, punto 3). Volver retrocede si hay historial de la app; si se
 * entró directo, cae a la portada de impulso de ese mismo aviso.
 * Ver `components/shell/section-top-bar.tsx`.
 */
export default async function ImpulsarSubLayout({
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
