import { Skeleton } from "@/components/ui";

/** Skeleton del inbox (§5.2): la silueta de la lista real, nunca un spinner. */
export default function MensajesLoading() {
  return (
    <>
      <Skeleton className="mb-5 h-8 w-36" />
      {/* Las pestañas (Personas · Grupos) y el buscador van en la silueta, no
          sólo la lista: si aparecieran recién con el contenido, la lista real
          nacería 100px más abajo de donde se dibujó el skeleton y toda la
          pantalla saltaría al cargar. */}
      <Skeleton className="mb-5 h-11 w-full" />
      <Skeleton className="mb-5 h-12 w-full rounded-full" />
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
