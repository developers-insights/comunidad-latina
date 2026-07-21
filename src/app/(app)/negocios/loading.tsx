import { NegociosSkeleton } from "./page";

/**
 * Skeleton dirigido de /negocios (Server Component, cero JS): al navegar, el
 * shell persistente muestra la silueta del contenido en vez de parpadear.
 * Reutiliza el MISMO skeleton que el fallback de Suspense de la página.
 */
export default function Loading() {
  return <NegociosSkeleton />;
}
