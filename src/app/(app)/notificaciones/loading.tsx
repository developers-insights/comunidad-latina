import { Skeleton } from "@/components/ui";

/** Silueta de la bandeja (§5.2): título + card destacada + filas — sin spinners. */
export default function NotificacionesLoading() {
  return (
    <>
      <Skeleton className="mb-6 h-8 w-48" />
      <Skeleton className="mb-6 h-32 w-full rounded-xl" />
      <Skeleton className="mb-2 h-3 w-16" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface px-4 py-3.5"
          >
            <Skeleton className="mt-1.5 size-2 rounded-full" />
            <div className="flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="mt-2 h-3.5 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
