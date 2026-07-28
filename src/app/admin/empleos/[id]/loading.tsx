import { Skeleton } from "@/components/ui";

/** Carga del detalle de un aviso: cabecera + tarjetas de postulación. */
export default function LoadingAdminEmpleoDetalle() {
  return (
    <div aria-busy="true" aria-label="Cargando postulaciones" className="flex flex-col gap-6">
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
      <ul className="flex flex-col gap-3">
        {[0, 1].map((row) => (
          <li key={row} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </li>
        ))}
      </ul>
    </div>
  );
}
