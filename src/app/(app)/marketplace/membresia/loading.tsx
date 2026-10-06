import { Skeleton } from "@/components/ui";
import { SkeletonScreen, ScreenHeaderSkeleton } from "@/components/ui/skeletons";

export default function MarketplaceMembresiaLoading() {
  return (
    <SkeletonScreen>
      <ScreenHeaderSkeleton className="mb-4" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    </SkeletonScreen>
  );
}
