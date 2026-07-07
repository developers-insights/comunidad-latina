import { Skeleton } from "@/components/ui";

/** Silueta de una card de post (shimmer §5.2 — nunca spinners de página). */
export function PostCardSkeleton() {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4 shadow-xs">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-1.5 h-3 w-16" />
        </div>
      </div>
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-4/5" />
      <Skeleton className="mt-2 h-4 w-2/5" />
      <div className="mt-4 flex gap-4">
        <Skeleton className="h-6 w-12" />
        <Skeleton className="h-6 w-12" />
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
