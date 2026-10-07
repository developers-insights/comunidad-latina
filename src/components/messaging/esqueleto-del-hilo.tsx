import { Skeleton } from "@/components/ui";

/**
 * La silueta del hilo mientras llega el resto: encabezado, aviso de seguridad,
 * burbujas a los dos lados y la barra de escribir en su lugar de siempre. Las
 * alturas son las reales (`size-11` los botones del encabezado, `min-h-11` el
 * campo) para que nada salte cuando entra el contenido.
 *
 * No es un `loading.tsx`: el hilo llama `notFound()` y un boundary de ruta le
 * quitaría el 404 (ver `app/loading-boundaries.test.ts`). Va en el `Suspense`
 * que la página abre DESPUÉS de decidir si la conversación existe.
 */
export function EsqueletoDelHilo({ grupo = false }: { grupo?: boolean }) {
  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col" aria-busy="true">
      <div className="flex items-center gap-3 border-b border-border-subtle pb-4">
        <Skeleton className="size-11 shrink-0 rounded-full" />
        <Skeleton className={grupo ? "size-14 shrink-0 rounded-full" : "size-10 shrink-0 rounded-full"} />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-1.5 h-3.5 w-24" />
        </div>
        <Skeleton className="size-11 shrink-0 rounded-full" />
      </div>

      {!grupo && <Skeleton className="mt-4 h-14 w-full rounded-lg" />}
      <Skeleton className="mx-auto mt-3 h-3 w-56" />

      <div className="flex flex-1 flex-col justify-end gap-2.5 py-5">
        <Skeleton className="h-11 w-3/5 rounded-2xl rounded-bl-md" />
        <Skeleton className="ml-auto h-11 w-1/2 rounded-2xl rounded-br-md" />
        <Skeleton className="h-16 w-2/3 rounded-2xl rounded-bl-md" />
        <Skeleton className="ml-auto h-11 w-2/5 rounded-2xl rounded-br-md" />
      </div>

      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-1 px-1 pb-2 pt-1">
        <Skeleton className="h-[3.75rem] w-full rounded-2xl" />
      </div>
    </div>
  );
}
