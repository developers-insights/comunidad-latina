import { ManoListSkeleton } from "@/components/comunidad";
import { Skeleton } from "@/components/ui";

/** Silueta del tablón: cabecera, reglas, bandeja de filtros y la grilla. */
export default function Loading() {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-11 w-32 rounded-md" />
      <Skeleton className="mt-2 h-20 w-full rounded-xl" />
      <Skeleton className="mt-4 h-11 w-full rounded-md" />
      <Skeleton className="mt-4 h-24 w-full rounded-xl" />
      <Skeleton className="mb-5 mt-4 h-44 w-full rounded-xl" />
      <ManoListSkeleton />
    </div>
  );
}
