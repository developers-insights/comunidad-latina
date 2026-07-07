import { Skeleton } from "@/components/ui";

/** Silueta del perfil mientras carga (§5.2) — nunca un spinner centrado. */
export default function PerfilLoading() {
  return (
    <div
      className="flex flex-col gap-8"
      role="status"
      aria-label="Cargando tu perfil"
    >
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="size-20 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-28" />
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}
