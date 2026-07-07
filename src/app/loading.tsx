import { Skeleton } from "@/components/ui";

/**
 * Loading raíz: skeleton genérico del shell (header + contenido) para
 * cualquier ruta sin loading.tsx propio. Shimmer, nunca spinner (§ estados).
 */
export default function RootLoading() {
  return (
    <div aria-busy="true" className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-4">
      {/* Header del shell */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>
      {/* Título + subtítulo */}
      <Skeleton className="mt-8 h-7 w-52" />
      <Skeleton className="mt-2 h-4 w-72" />
      {/* Tarjetas de contenido */}
      <div className="mt-6 space-y-4">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-36 w-full rounded-2xl" />
      </div>
    </div>
  );
}
