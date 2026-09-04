import { Skeleton } from "@/components/ui";
import { COPY } from "./copy";

/**
 * Siluetas de la lista de empleos — shimmer, nunca spinner (§5.2). Misma caja
 * que JobCard (bezel + media 4:5 + pie) para que el contenido no salte cuando
 * llega: la franja de vidrio vive DENTRO de la media, así que el bloque de
 * texto del skeleton va montado sobre el rectángulo, no debajo.
 */
export function JobCardSkeleton() {
  return (
    <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel" aria-hidden="true">
      <div className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface">
        <div className="relative aspect-[4/5] w-full">
          <Skeleton className="size-full rounded-none" />
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3.5">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        </div>
        <div className="flex flex-col gap-2.5 p-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-11 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * Silueta de la tarjeta de SERVICIO. Existe por separado y no reusa la de
 * empleo porque las dos tarjetas tienen otra forma —una es un afiche 4:5, la
 * otra es horizontal y sin foto—, y una silueta que no calza con lo que llega
 * produce exactamente el salto que el skeleton existe para evitar.
 */
export function ServiceCardSkeleton() {
  return (
    <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel" aria-hidden="true">
      <div className="flex flex-col gap-3.5 rounded-[calc(var(--radius-xl)-6px)] bg-surface p-4">
        <div className="flex items-start gap-3.5">
          <Skeleton className="size-12 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-11 w-full rounded-full" />
      </div>
    </div>
  );
}

export function JobListSkeleton({
  count = 3,
  /**
   * Qué silueta dibujar. Sale de la pestaña activa: en "Servicios" pintar
   * afiches de empleo sería anunciar un contenido que no va a llegar. En
   * "Todos" manda la de empleo, que es la más alta — el contenido real se
   * acomoda hacia arriba, que se nota menos que hacia abajo.
   */
  variant = "job",
}: {
  count?: number;
  variant?: "job" | "service";
}) {
  const Card = variant === "service" ? ServiceCardSkeleton : JobCardSkeleton;
  return (
    <div
      role="status"
      aria-label={COPY.list.loadingLabel}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} />
      ))}
      <span className="sr-only">{COPY.list.loadingLabel}</span>
    </div>
  );
}
