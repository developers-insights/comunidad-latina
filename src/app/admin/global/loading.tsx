import { Skeleton } from "@/components/ui";

/**
 * Carga de todo el segmento Global (resumen, dominios, administradores,
 * contenido y registro). Es un esqueleto y no un spinner (§5.2): dibuja la
 * silueta real —encabezado, selector de comunidad, lista de tarjetas— para que
 * la página no salte cuando llegan los datos.
 *
 * Vive en el layout del segmento porque las cinco pantallas comparten forma. Si
 * alguna se vuelve muy distinta, se le pone su propio `loading.tsx` al lado.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-full max-w-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-11 w-28 rounded-full" />
          <Skeleton className="h-11 w-36 rounded-full" />
          <Skeleton className="h-11 w-32 rounded-full" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-20 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
