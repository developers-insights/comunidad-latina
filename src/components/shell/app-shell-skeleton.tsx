import { Skeleton } from "@/components/ui";

/**
 * Skeleton del shell: silueta del header sticky + contenido mobile-first +
 * barra inferior, no un spinner (§ estados). Shimmer vía la utility `skeleton`.
 * Server component: cero JS.
 *
 * Coherente con (app)/layout.tsx: mismo ancho (max-w-lg), mismo padding y una
 * pista de bottom-nav para que la transición al contenido real no salte.
 *
 * ── Dónde puede montarse (IMPORTANTE) ──────────────────────────────────────
 * Vivía en `src/app/loading.tsx`, o sea un Suspense alrededor de TODA la app.
 * Eso hacía que el shell se enviara antes de que corriera el cuerpo de la
 * página: con los headers ya mandados, `notFound()` no podía cambiar el status
 * y TODA ruta de detalle devolvía 200 en vez de 404 (soft 404). Ver
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`
 * §Status Codes.
 *
 * Por eso su `loading.tsx` sólo puede colgar de segmentos que NO tengan ninguna
 * ruta con `notFound()` debajo — en la práctica, las rutas de LISTA aisladas en
 * un route group `(lista)/`, hermano del `[id]/` que sí hace notFound(). El
 * test `src/app/loading-boundaries.test.ts` verifica esta invariante sobre el
 * árbol real de `src/app` y falla si alguien vuelve a poner un boundary de más.
 */
export function AppShellSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Cargando"
      className="flex min-h-dvh flex-col bg-canvas"
    >
      {/* Header sticky del shell */}
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-lg items-center justify-between px-4">
          <Skeleton className="h-6 w-32 rounded-md" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
          </div>
        </div>
      </div>

      {/* Contenido */}
      <div className="mx-auto w-full max-w-lg flex-1 px-4 pb-28 pt-5">
        {/* Título de sección */}
        <Skeleton className="h-7 w-48 rounded-md" />
        <Skeleton className="mt-2.5 h-4 w-64 rounded-md" />

        {/* Fila de chips/filtros */}
        <div className="mt-5 flex gap-2">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>

        {/* Tarjetas de contenido (silueta tipo card del feed) */}
        <div className="mt-6 space-y-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-border-subtle bg-surface p-4 shadow-xs"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32 rounded-md" />
                  <Skeleton className="h-3 w-20 rounded-md" />
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Skeleton className="h-4 w-full rounded-md" />
                <Skeleton className="h-4 w-11/12 rounded-md" />
                <Skeleton className="h-4 w-3/5 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pista de la bottom-nav para evitar salto al hidratar el shell */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border-subtle bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-lg items-center justify-around px-6">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <Skeleton className="h-6 w-6 rounded-md" />
              <Skeleton className="h-2 w-8 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
