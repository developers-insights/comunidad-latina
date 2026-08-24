import { Skeleton } from "@/components/ui";

/** Silueta exacta de la StoreCard (avatar + líneas + fila de acciones) — shimmer, nunca spinner (§5.2). */
export function StoreCardSkeleton() {
  return (
    <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel" aria-hidden="true">
      <div className="flex flex-col gap-3 rounded-[calc(var(--radius-xl)-6px)] bg-surface p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-14 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        </div>
        <Skeleton className="h-3.5 w-2/5" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
    </div>
  );
}

export function StoreListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Cargando tiendas">
      {Array.from({ length: count }, (_, index) => (
        <StoreCardSkeleton key={index} />
      ))}
      <span className="sr-only">Cargando tiendas…</span>
    </div>
  );
}
