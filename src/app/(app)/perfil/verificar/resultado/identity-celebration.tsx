"use client";

import { useEffect } from "react";
import { Celebration, useCelebration } from "@/components/motion";

/**
 * Isla client acotada: dispara UNA celebración elegante cuando la identidad
 * quedó verificada. El resto de la página de resultado es server component —
 * esto sólo monta el destello + check sobre el estado de éxito.
 *
 * prefers-reduced-motion ya está resuelto dentro de <Celebration> (check estático
 * con fade, sin rayos). role="status" anuncia el logro sin atrapar foco.
 */
export function IdentityCelebration({ message }: { message: string }) {
  const { celebrating, celebrate } = useCelebration();

  useEffect(() => {
    celebrate();
  }, [celebrate]);

  return <Celebration active={celebrating} message={message} />;
}
