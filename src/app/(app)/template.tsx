import type { ReactNode } from "react";
import { PageTransition } from "@/components/experience/page-transition";

/**
 * Template del shell autenticado: envuelve SOLO el contenido de página en la
 * transición. El Header + BottomNav están en (app)/layout.tsx (persiste) →
 * no parpadean entre navegaciones.
 */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
