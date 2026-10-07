import { Skeleton } from "@/components/ui";
import { SkeletonScreen } from "@/components/ui/skeletons";

export default function PerfilVerificarResultadoLoading() {
  return (
    <SkeletonScreen className="flex flex-col gap-6 pb-8">
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-12 w-full rounded-full" />
    </SkeletonScreen>
  );
}
