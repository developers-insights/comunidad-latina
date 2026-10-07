import { Skeleton } from "@/components/ui";
import { SkeletonScreen, TopBarSkeleton, SectionHeadingSkeleton } from "@/components/ui/skeletons";

export default function ComunidadEspacioLoading() {
  return (
    <SkeletonScreen>
      <TopBarSkeleton />
      <SectionHeadingSkeleton />
      <Skeleton className="mt-5 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-4/5" />
      <Skeleton className="mb-2 mt-6 h-3 w-40" />
      <div className="flex flex-wrap gap-2">
        {["w-24", "w-32", "w-20", "w-28", "w-24"].map((width, index) => (
          <Skeleton key={index} className={`h-9 rounded-full ${width}`} />
        ))}
      </div>
      <Skeleton className="mt-6 h-12 w-full rounded-full" />
    </SkeletonScreen>
  );
}
