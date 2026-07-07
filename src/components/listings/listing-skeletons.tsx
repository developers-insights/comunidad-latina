import { Skeleton } from "@/components/ui";

/** Silueta exacta de la ListingCard — shimmer, nunca spinner (§5.2). */
export function ListingCardSkeleton() {
  return (
    <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel" aria-hidden="true">
      <div className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface">
        <Skeleton className="aspect-video w-full rounded-none" />
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-7 w-2/5" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function ListingListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Cargando propiedades">
      {Array.from({ length: count }, (_, index) => (
        <ListingCardSkeleton key={index} />
      ))}
      <span className="sr-only">Cargando propiedades…</span>
    </div>
  );
}
