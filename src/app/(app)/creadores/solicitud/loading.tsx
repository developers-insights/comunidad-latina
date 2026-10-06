import { Skeleton } from "@/components/ui";
import { SkeletonScreen, ScreenHeaderSkeleton } from "@/components/ui/skeletons";

export default function CreadoresSolicitudLoading() {
  return (
    <SkeletonScreen className="flex flex-col gap-5">
      <ScreenHeaderSkeleton className="mb-0" />
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-52 w-full rounded-xl" />
    </SkeletonScreen>
  );
}
