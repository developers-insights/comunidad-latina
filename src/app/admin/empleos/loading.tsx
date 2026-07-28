import { Skeleton } from "@/components/ui";

/**
 * Carga del listado de Empleos: esqueleto con la MISMA silueta que la lista
 * real (badge + título + línea de metadatos), para que al llegar los datos no
 * salte el layout.
 */
export default function LoadingAdminEmpleos() {
  return (
    <section aria-busy="true" aria-label="Cargando empleos" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <ul className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((row) => (
          <li
            key={row}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3"
          >
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </li>
        ))}
      </ul>
    </section>
  );
}
