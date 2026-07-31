import { CARD_MEDIA_ASPECT, LISTING_CARD_ASPECT, Skeleton } from "@/components/ui";

/**
 * Silueta exacta de la ListingCard — shimmer, nunca spinner (§5.2).
 *
 * "Exacta" tiene que ser literal o el skeleton deja de servir: medía
 * `aspect-video` mientras la card real hacía rato que dibujaba 4:5, así que al
 * cargar la lista TODO saltaba hacia abajo (CLS). Ahora la proporción se
 * importa del mismo lugar del que la toma la card, así que no pueden divergir.
 * El `gap-2.5 p-4` es el mismo ritmo unificado del 2026-07-30.
 */
export function ListingCardSkeleton() {
  return (
    <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel" aria-hidden="true">
      <div className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface">
        <Skeleton className={`${CARD_MEDIA_ASPECT[LISTING_CARD_ASPECT]} w-full rounded-none`} />
        <div className="flex flex-col gap-2.5 p-4">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-7 w-2/5" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function ListingListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Cargando propiedades">
      {Array.from({ length: count }, (_, index) => (
        <ListingCardSkeleton key={index} />
      ))}
      <span className="sr-only">Cargando propiedades…</span>
    </div>
  );
}
