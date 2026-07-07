import { Skeleton } from "@/components/ui";

/** Silueta del perfil público mientras carga (§5.2). */
export default function PerfilPublicoLoading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-label="Cargando el perfil"
    >
      <div className="flex justify-end">
        <Skeleton className="size-11 rounded-full" />
      </div>
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="size-20 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-28" />
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-13 w-full rounded-full" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}
