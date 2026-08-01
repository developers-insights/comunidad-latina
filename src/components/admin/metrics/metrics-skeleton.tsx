import { Skeleton } from "@/components/ui";
import { COPY } from "@/lib/metrics/copy";

/**
 * Carga del tablero: la SILUETA del resultado, no un spinner centrado.
 *
 * La RPC barre doce orígenes; en una comunidad grande y con ventana de 90 días
 * puede tardar. Un spinner en ese hueco no dice nada; el esqueleto ya muestra
 * que vienen tres tarjetas y un gráfico, así que la página no salta cuando
 * llegan los números.
 */
export function MetricsSkeleton() {
  return (
    <div className="flex flex-col gap-8" role="status" aria-label={COPY.loadingLabel}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xs"
          >
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-full" />
            <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-3">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-32 w-full sm:h-48" />
      </div>

      <span className="sr-only">{COPY.loadingLabel}</span>
    </div>
  );
}
