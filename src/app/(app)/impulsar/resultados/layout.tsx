import type { ReactNode } from "react";
import { exigirSesion } from "@/lib/auth/exigir-sesion";

/**
 * Resultados de promociones: la sesión se exige acá y no sólo en la página,
 * porque la página cuelga de un `loading.tsx` y un redirect desde adentro del
 * stream rompe en el cliente. Ver `lib/auth/exigir-sesion.ts`.
 */
export default async function ResultadosDePromocionesLayout({ children }: { children: ReactNode }) {
  await exigirSesion("/impulsar/resultados");

  return children;
}
