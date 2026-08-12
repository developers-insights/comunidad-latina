import { Skeleton } from "@/components/ui";
import { RecursosSkeleton } from "@/components/comunidad";

/**
 * Silueta del directorio de ayuda. Acá no hace falta route group: debajo de
 * `/comunidad/recursos` no cuelga ninguna ruta que llame `notFound()`, así que
 * el boundary no puede convertir un 404 en un 200. Si algún día se agrega un
 * detalle `[id]`, este archivo tiene que mudarse a `(lista)/` — y el test
 * `src/app/loading-boundaries.test.ts` lo va a avisar antes del deploy.
 */
export default function RecursosLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-2 h-20 w-full rounded-xl" />
      <Skeleton className="mb-8 mt-5 h-40 w-full rounded-xl" />
      <RecursosSkeleton />
    </div>
  );
}
