import { Skeleton } from "@/components/ui";
import { SkeletonScreen } from "@/components/ui/skeletons";

export default function VerificacionLoading() {
  return (
    <SkeletonScreen className="flex flex-col gap-6 pb-10">
      <div className="flex flex-col items-start gap-3">
        <Skeleton className="size-12 rounded-full" />
        <div className="w-full">
          <Skeleton className="h-8 w-3/5" />
          <Skeleton className="mt-2 h-4 w-4/5" />
        </div>
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </SkeletonScreen>
  );
}
