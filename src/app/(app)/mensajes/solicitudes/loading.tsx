import { Skeleton } from "@/components/ui";

/**
 * Silueta de Solicitudes. Calca la tarjeta real —avatar, nombre, la línea de
 * "quiere contactarte", la cita del primer mensaje y la fila de botones— para
 * que al llegar los datos no se mueva nada de lugar.
 */
export default function SolicitudesLoading() {
  return (
    <>
      <Skeleton className="mb-5 h-8 w-36" />
      <Skeleton className="mb-5 h-11 w-full" />
      <Skeleton className="mb-4 h-4 w-4/5" />

      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="rounded-lg border-2 border-border-subtle bg-surface p-4 shadow-xs"
          >
            <div className="flex items-start gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="mt-2 h-4 w-2/3" />
                <Skeleton className="mt-2 h-12 w-full rounded-md" />
              </div>
            </div>
            <div className="mt-3 flex gap-2 border-t border-border-subtle pt-3">
              <Skeleton className="h-9 w-24 rounded-full" />
              <Skeleton className="h-9 w-20 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
