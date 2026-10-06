import type { ReactNode } from "react";

/**
 * El vigilante de llamadas entrantes vivía acá y se mudó al shell de `(app)`
 * (2026-10-06): colgado sólo en esta sección, el timbre no sonaba en el resto
 * de la app. No volver a montarlo acá — sonaría dos veces.
 */
export default function LlamadasLayout({ children }: { children: ReactNode }) {
  return children;
}
