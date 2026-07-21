import { Skeleton } from "@/components/ui";

/**
 * Silueta de una card de post (shimmer §5.2 — nunca spinners de página).
 *
 * Matchea la silueta de la card rediseñada (módulo social, ver
 * card-post-media.tsx: `<CardMedia aspect="portrait" />` sin envoltorio con
 * padding): foto 4:5 FULL-BLEED de punta a punta de la card, primero — es lo
 * primero que el ojo ve, igual que la card real — y recién debajo, ya con
 * padding, el header (avatar + nombre), el cuerpo y la fila de acciones.
 */
export function PostCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-xs">
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="flex items-center gap-2.5 p-4 pb-0">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-1.5 h-3 w-16" />
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/5" />
        <div className="mt-2 flex gap-4">
          <Skeleton className="h-6 w-12" />
          <Skeleton className="h-6 w-12" />
        </div>
      </div>
    </div>
  );
}

/** Silueta del feed completo: tabs + composer + cards. */
export function FeedSkeleton({ withComposer = true }: { withComposer?: boolean }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      {withComposer && <Skeleton className="h-32 w-full rounded-lg" />}
      <PostCardSkeleton />
      <Skeleton className="aspect-video w-full rounded-xl" />
      <PostCardSkeleton />
    </div>
  );
}
