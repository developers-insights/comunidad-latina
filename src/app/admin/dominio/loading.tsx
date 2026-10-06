import { Skeleton } from "@/components/ui";
import { SkeletonScreen } from "@/components/ui/skeletons";

export default function AdminDominioLoading() {
  return (
    <SkeletonScreen className="flex flex-col gap-8">
      <div>
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="mt-2 h-4 w-full max-w-lg" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
    </SkeletonScreen>
  );
}
