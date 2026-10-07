import { Skeleton } from "@/components/ui";
import { SkeletonScreen, ScreenHeaderSkeleton } from "@/components/ui/skeletons";

export default function NegociosCuentaLoading() {
  return (
    <SkeletonScreen className="flex flex-col gap-6">
      <ScreenHeaderSkeleton className="mb-0" />
      <Skeleton className="h-52 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </SkeletonScreen>
  );
}
