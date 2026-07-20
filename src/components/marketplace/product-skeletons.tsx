import { Skeleton } from "@/components/ui";

/** Silueta exacta de la ProductCard (grilla 2-col, foto cuadrada) — shimmer, nunca spinner (§5.2). */
export function ProductCardSkeleton() {
  return (
    <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel" aria-hidden="true">
      <div className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface">
        <Skeleton className="aspect-square w-full rounded-none" />
        <div className="flex flex-col gap-2 p-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-6 w-2/5 rounded-full" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3"
      role="status"
      aria-label="Cargando productos"
    >
      {Array.from({ length: count }, (_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
      <span className="sr-only">Cargando productos…</span>
    </div>
  );
}
