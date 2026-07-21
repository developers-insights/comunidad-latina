import { Skeleton } from "@/components/ui";

/** Silueta del perfil público mientras carga (§5.2). */
export default function PerfilPublicoLoading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-label="Cargando el perfil"
    >
      {/* Menú ⋯ arriba a la derecha */}
      <div className="-mt-2 flex justify-end">
        <Skeleton className="size-11 rounded-full" />
      </div>

      {/* Cabecera: avatar + nombre + ubicación + contadores + CTA de mensaje */}
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="size-20 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-28" />
        <div className="flex justify-center gap-8">
          <Skeleton className="h-10 w-16 rounded-lg" />
          <Skeleton className="h-10 w-16 rounded-lg" />
        </div>
        <Skeleton className="h-13 w-full rounded-lg" />
      </div>

      {/* Tarjeta del Trust Score */}
      <Skeleton className="h-44 w-full rounded-xl" />

      {/* Grid de publicaciones */}
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="aspect-square w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
