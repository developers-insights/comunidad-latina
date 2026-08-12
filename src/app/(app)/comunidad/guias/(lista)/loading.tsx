import { Skeleton } from "@/components/ui";
import { GuiaListSkeleton } from "@/components/comunidad";

/**
 * Silueta del índice de guías dentro de Comunidad.
 *
 * En el route group `(lista)`, hermano de `[slug]/`: el lector de una guía
 * llama `notFound()` cuando el slug no existe, y un boundary por encima lo
 * dejaría clavado en 200. Ver `src/app/loading-boundaries.test.ts`.
 */
export default function ComunidadGuiasLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-2 h-20 w-full rounded-xl" />
      <Skeleton className="mb-8 mt-5 h-36 w-full rounded-xl" />
      <GuiaListSkeleton />
    </div>
  );
}
