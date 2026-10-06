import { Skeleton } from "@/components/ui";
import { SkeletonScreen, SectionHeadingSkeleton, TabsSkeleton } from "@/components/ui/skeletons";

export default function EmpleosMisAplicacionesLoading() {
  return (
    <SkeletonScreen>
      <SectionHeadingSkeleton className="mb-4" />
      <TabsSkeleton />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </SkeletonScreen>
  );
}
