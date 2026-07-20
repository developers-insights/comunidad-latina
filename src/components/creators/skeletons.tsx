import { Skeleton } from "@/components/ui";

/** Silueta de una card grande (feed de trabajos / directorio de creadores). */
function MediaCardSkeleton() {
  return (
    <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel">
      <div className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface">
        <Skeleton className="aspect-video w-full rounded-none" />
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-5 w-3/4 rounded-md" />
          <Skeleton className="h-7 w-28 rounded-md" />
          <Skeleton className="h-4 w-1/2 rounded-md" />
          <Skeleton className="mt-1 h-11 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function GigListSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <MediaCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function CreatorListSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <MediaCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ContractsListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="rounded-lg border border-border-subtle bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-24 rounded-md" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-5 w-2/3 rounded-md" />
          <Skeleton className="mt-2 h-4 w-1/3 rounded-md" />
        </div>
      ))}
    </div>
  );
}
