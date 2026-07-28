import { Skeleton } from "@/components/ui";

/** Silueta de "Guardados" mientras carga (§5.2) — nunca un spinner centrado. */
export default function GuardadosLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Cargando tus guardados">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-[88px] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
