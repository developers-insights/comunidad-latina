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

export function JobListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label={COPY.list.loadingLabel}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      {Array.from({ length: count }, (_, index) => (
        <JobCardSkeleton key={index} />
      ))}
      <span className="sr-only">{COPY.list.loadingLabel}</span>
    </div>
  );
}
