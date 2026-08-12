import { Skeleton } from "@/components/ui";

/**
 * Siluetas de carga de Comunidad.
 *
 * No son "un spinner más lindo": reservan EXACTAMENTE el alto de lo que va a
 * llegar (4:3 de foto + tres líneas en las cards; cuatro filas en la ficha de
 * recurso), así la página no salta cuando entran los datos — que es lo que mide
 * CLS y lo que se siente como una app barata cuando falla.
 */

export function CasoCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <div className="flex gap-1.5">
          <Skeleton className="h-6 w-24 rounded-sm" />
          <Skeleton className="h-6 w-20 rounded-sm" />
        </div>
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

export function CasoListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <CasoCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function RecursoCardSkeleton() {
  return (
    <div className="rounded-xl bg-bezel-shell p-1.5">
      <div className="flex flex-col gap-4 rounded-[calc(var(--radius-xl)-6px)] bg-surface p-5">
        <div className="space-y-2">
          <Skeleton className="h-6 w-3/5" />
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-11 flex-1 rounded-md" />
          <Skeleton className="h-11 flex-1 rounded-md" />
        </div>
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

export function RecursosSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      {Array.from({ length: 2 }, (_, grupo) => (
        <div key={grupo} className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-1 gap-4">
            <RecursoCardSkeleton />
            <RecursoCardSkeleton />
          </div>
        </div>
      ))}
    </div>
  );
}

export function GuiaListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-lg border border-border-subtle bg-surface"
        >
          <Skeleton className="aspect-[16/9] w-full rounded-none" />
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-6 w-20 rounded-sm" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
