import { Skeleton } from "@/components/ui";
import { SkeletonScreen, TopBarSkeleton, ScreenHeaderSkeleton } from "@/components/ui/skeletons";

export default function ImpulsarCrearLoading() {
  return (
    <SkeletonScreen className="flex flex-col gap-6 pb-8">
      <TopBarSkeleton />
      <ScreenHeaderSkeleton className="mb-0" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </SkeletonScreen>
  );
}
