import { Skeleton } from "@/components/ui";

/** Silueta del perfil propio mientras carga (§5.2) — nunca un spinner centrado. */
export default function PerfilLoading() {
  return (
    <div
      className="flex flex-col gap-8"
      role="status"
      aria-label="Cargando tu perfil"
    >
      {/* Cabecera: avatar + nombre + ubicación + contadores + acciones */}
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="size-20 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-28" />
        <div className="flex justify-center gap-8">
          <Skeleton className="h-10 w-16 rounded-lg" />
          <Skeleton className="h-10 w-16 rounded-lg" />
        </div>
        <Skeleton className="h-11 w-full rounded-lg" />
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
