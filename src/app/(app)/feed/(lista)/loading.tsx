import { Skeleton } from "@/components/ui";
import { FeedSkeleton } from "@/components/feed";

export default function FeedLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-4 flex gap-4 border-b border-border-subtle pb-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="mt-4">
        <FeedSkeleton />
      </div>
    </div>
  );
}
