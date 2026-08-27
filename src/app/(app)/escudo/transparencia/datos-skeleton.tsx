import { Skeleton } from "@/components/ui";

/**
 * Silueta de lo que espera a la base en /escudo/transparencia: las cifras y los
 * casos. Nunca un spinner.
 *
 * NO dibuja el hero ni el bloque de honestidad, y eso es el punto: esas dos
 * cosas ya están pintadas cuando esto aparece —son síncronas, viven en el
 * componente de la página— así que incluirlas acá las haría parpadear de
 * esqueleto a contenido sin motivo. Un esqueleto sólo puede cubrir lo que
 * todavía no llegó.
 *
 * Las cifras se dibujan con la MISMA forma que tienen llenas —número angosto a
 * la izquierda, dos renglones de texto a la derecha— para que la pantalla no
 * salte cuando llegan los datos. Un esqueleto que no coincide con el layout
 * final es un layout shift disfrazado de estado de carga.
 *
 * (Antes esto era `loading.tsx`. Por qué dejó de serlo: ver el docblock de
 * `DatosDeTransparencia` en page.tsx.)
 */
export function DatosSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-28" />
        <div className="rounded-xl bg-bezel-shell p-1.5">
          <div className="flex flex-col divide-y divide-border-subtle rounded-[calc(var(--radius-xl)-6px)] bg-surface px-5 py-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-baseline gap-4 py-4">
                <Skeleton className="h-8 w-10 shrink-0" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-2 h-3.5 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-16 w-full rounded-lg" />
        {Array.from({ length: 2 }).map((_, index) => (
          <Skeleton key={index} className="h-64 w-full rounded-xl" />
        ))}
      </div>
    </>
  );
}
