import { Skeleton } from "@/components/ui";

/**
 * Silueta del índice de Comunidad.
 *
 * Vive dentro del route group `(indice)` y no en `comunidad/`, y eso NO es
 * cosmético: un `loading.tsx` es un `<Suspense>` alrededor de su segmento y de
 * todo lo que cuelga de él, así que puesto un nivel más arriba cubriría a
 * `/comunidad/perdidos/[id]` y a `/comunidad/guias/[slug]` — que llaman
 * `notFound()` — y los convertiría en soft 404 (200 con cara de 404). El route
 * group no cambia la URL pero sí el árbol de segmentos. Lo verifica
 * `src/app/loading-boundaries.test.ts`; el patrón es el mismo de
 * `eventos/(lista)/loading.tsx`.
 */
export default function ComunidadIndiceLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="mt-4 h-4 w-4/5" />
      <Skeleton className="mt-2 h-4 w-3/5" />
      <Skeleton className="mt-5 h-32 w-full rounded-xl" />
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-[88px] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
