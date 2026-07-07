import { Skeleton } from "@/components/ui";

/** Skeleton del hilo (§5.2): header + burbujas alternadas + input. */
export default function HiloLoading() {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-1.5 h-3 w-24" />
        </div>
      </div>
      <Skeleton className="mt-4 h-11 w-full rounded-lg" />
      <div className="mt-6 flex flex-col gap-3">
        <Skeleton className="h-14 w-3/5 self-start rounded-2xl" />
        <Skeleton className="h-10 w-1/2 self-end rounded-2xl" />
        <Skeleton className="h-16 w-2/3 self-start rounded-2xl" />
        <Skeleton className="h-10 w-2/5 self-end rounded-2xl" />
      </div>
      <Skeleton className="mt-8 h-14 w-full rounded-2xl" />
    </div>
  );
}
