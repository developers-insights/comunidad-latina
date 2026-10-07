import { Skeleton } from "@/components/ui";
import { SkeletonScreen, TopBarSkeleton, ScreenHeaderSkeleton } from "@/components/ui/skeletons";

export default function PerfilVerificarLoading() {
  return (
    <SkeletonScreen className="flex flex-col gap-6 pb-8">
      <TopBarSkeleton />
      <ScreenHeaderSkeleton className="mb-0" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-36 w-full rounded-xl" />
    </SkeletonScreen>
  );
}
