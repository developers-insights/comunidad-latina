import { Skeleton } from "@/components/ui";
import { PostCardSkeleton } from "@/components/feed";

export default function PostDetailLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-10 w-32 rounded-md" />
      <div className="mt-4">
        <PostCardSkeleton />
      </div>
      <Skeleton className="mt-6 h-6 w-40" />
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex items-start gap-2.5">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-16 flex-1 rounded-lg" />
        </div>
        <div className="flex items-start gap-2.5">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-16 flex-1 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
