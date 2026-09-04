/**
 * Barril del shell — SÓLO lo que puede vivir del lado del cliente.
 *
 * `header.tsx`, `bottom-nav.tsx` y `shell-context.ts` NO se exportan acá a
 * propósito: arrastran módulos con `import "server-only"` (tenant, sesión,
 * consultas), y un barril que los reexporte mete todo ese grafo en el bundle
 * del navegador apenas una pantalla `"use client"` importe de acá. Ya pasó una
 * vez con el barril de reseñas y rompió el build entero — ver
 * `src/test/server-only-boundary.test.ts`. Se importan por su ruta puntual.
 */
export {
  SectionTopBar,
  useSectionBack,
  type SectionTopBarProps,
} from "./section-top-bar";
export { InternalHistoryTracker } from "./internal-history-tracker";
export { hasInternalHistory, markInternalNavigation } from "./internal-history";
export { SHELL_COPY } from "./copy";
