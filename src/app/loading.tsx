import { Skeleton } from "@/components/ui";

/**
 * Loading raíz: skeleton premium que replica la SILUETA del shell real
 * (header sticky + contenido mobile-first + barra inferior), no un spinner
 * (§ estados). Shimmer vía la utility `skeleton`. Server component: cero JS.
 *
 * Coherente con (app)/layout.tsx: mismo ancho (max-w-lg), mismo padding y una
 * pista de bottom-nav para que la transición al contenido real no salte.
 */
export default function RootLoading() {
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
