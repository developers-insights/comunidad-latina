import { PedidoListSkeleton } from "@/components/comunidad";
import { Skeleton } from "@/components/ui";

/** Silueta del tablón: cabecera, CTA, reglas, bandeja de filtros y la grilla. */
export default function Loading() {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="mt-4 h-11 w-full rounded-md sm:w-48" />
      <Skeleton className="mt-4 h-24 w-full rounded-xl" />
      <Skeleton className="mt-4 h-11 w-32 rounded-md" />
      <Skeleton className="mb-5 mt-4 h-56 w-full rounded-xl" />
      <PedidoListSkeleton />
    </div>
  );
}
