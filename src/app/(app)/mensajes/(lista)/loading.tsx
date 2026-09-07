import { Skeleton } from "@/components/ui";

/**
 * Skeleton del inbox (§5.2): la silueta de la lista real, nunca un spinner.
 *
 * Todo lo que va arriba de la lista entra en la silueta —título, pestañas,
 * buscador y chips de filtro— porque si apareciera recién con el contenido, la
 * lista real nacería 160px más abajo de donde se dibujó el skeleton y la
 * pantalla entera saltaría al cargar. Las alturas son las de verdad: `h-11` es
 * el alto de las pestañas y de los chips, `h-12` el del campo de búsqueda.
 */
export default function MensajesLoading() {
  return (
    <>
      <Skeleton className="mb-5 h-8 w-36" />
      <Skeleton className="mb-5 h-11 w-full" />
      <Skeleton className="mb-5 h-12 w-full rounded-full" />

      <div className="mb-4 flex gap-2">
        <Skeleton className="h-11 w-20 rounded-full" />
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface p-4 shadow-xs"
          >
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="mt-2 h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
