import { Skeleton } from "@/components/ui";
import { CasoListSkeleton } from "@/components/comunidad";

/**
 * Silueta del listado de Perdido y encontrado.
 *
 * Va en el route group `(lista)`, hermano de `[id]/`, para no envolver al
 * detalle: ese llama `notFound()` y con un boundary encima devolvería 200 en
 * vez de 404. Ver la cabecera de `src/app/loading-boundaries.test.ts`.
 */
export default function PerdidosLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-2 h-20 w-full rounded-xl" />
      <Skeleton className="mb-4 mt-3 h-[72px] w-full rounded-xl" />
      <Skeleton className="mb-5 h-[168px] w-full rounded-xl" />
      <CasoListSkeleton />
    </div>
  );
}
