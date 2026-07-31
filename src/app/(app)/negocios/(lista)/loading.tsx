import { NegociosSkeleton } from "./list-shell";

/**
 * Skeleton dirigido de /negocios (Server Component, cero JS): al navegar, el
 * shell persistente muestra la silueta del contenido en vez de parpadear.
 * Reutiliza el MISMO skeleton que el fallback de Suspense de la página.
 *
 * POR QUÉ VIVE EN `(lista)/` Y NO EN `negocios/`: desde el 2026-07-30 existe
 * `/negocios/[id]`, que llama `notFound()` para un id que no es un negocio. Un
 * `loading.tsx` por ENCIMA de esa ruta es un límite de Suspense por encima del
 * 404: la respuesta sale 200 con este esqueleto y la pantalla de "no existe"
 * nunca llega. Es exactamente el bug que se arregló el 27/7 en el resto de los
 * detalles, y el grupo de ruta es el mismo remedio: acota este fallback al
 * listado y deja el detalle sin techo. Hay un test que lo ancla
 * (`src/app/loading-boundaries.test.ts`).
 */
export default function Loading() {
  return <NegociosSkeleton />;
}
