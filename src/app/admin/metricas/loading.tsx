import { Skeleton } from "@/components/ui";
import { MetricsSkeleton } from "@/components/admin/metrics/metrics-skeleton";

/**
 * Carga de la ruta completa (entrada al tablero desde otra sección del panel).
 * Los cambios de filtro DENTRO del tablero los cubre el Suspense de page.tsx,
 * que remonta con la key del filtro; este archivo cubre la primera llegada.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-11 w-24 rounded-full" />
          <Skeleton className="h-11 w-24 rounded-full" />
          <Skeleton className="h-11 w-24 rounded-full" />
        </div>
      </div>
      <MetricsSkeleton />
    </div>
  );
}
