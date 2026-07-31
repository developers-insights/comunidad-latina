import Link from "next/link";
import { ArrowUpRight, ImageSquare } from "@phosphor-icons/react/dist/ssr";
import { firstPhotoUrl, formatListingPrice } from "@/components/listings";
import { listingViewHref } from "@/lib/monetization/href";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/**
 * LA TARJETA DEL AVISO, ARRIBA DEL HILO.
 *
 * El problema real que resuelve (§3 del feedback consolidado): quien publica
 * tiene varios avisos abiertos y recibe mensajes de todos. Un hilo que arranca
 * con "Hola, ¿sigue disponible?" y nada más obliga a las dos partes a adivinar
 * de qué anuncio están hablando — y adivinar mal es el origen de la mitad de
 * los malentendidos de precio.
 *
 * Por qué una TARJETA y no el link que ya había en el header: el header tenía
 * el título en 12 px al lado del Trust Score, compitiendo por el mismo renglón
 * y truncado casi siempre. Foto + título + precio es lo que hace que la otra
 * persona reconozca el aviso de un vistazo, que es lo único que se le pedía.
 *
 * Server Component: es data, no interacción. Y `listingViewHref` cubre los
 * verticales que sí tienen detalle propio; los que todavía no lo tienen (hoy
 * Negocios) caen a su listado en vez de a un 404.
 */

export interface ThreadListingCardProps {
  listing: {
    id: string;
    kind: string;
    title: string;
    photos?: string[] | null;
    priceAmount?: number | null;
    priceCurrency?: string | null;
    pricePeriod?: string | null;
  };
  locale: string;
  className?: string;
}

export function ThreadListingCard({ listing, locale, className }: ThreadListingCardProps) {
  const photoUrl = firstPhotoUrl(listing.photos ?? []);
  const priceLabel = formatListingPrice(
    listing.priceAmount ?? null,
    listing.priceCurrency ?? "usd",
    listing.pricePeriod ?? null,
    locale,
  );
  const href = listingViewHref(listing.kind, listing.id);

  return (
    <Link
      href={href}
      aria-label={`${COPY.thread.viewListing}: ${listing.title}`}
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-2.5",
        "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:border-brand hover:bg-brand-tint active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      <span className="relative size-14 shrink-0 overflow-hidden rounded-md bg-surface-subtle">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- miniatura de 56px: next/image no aporta acá y suma un round-trip al optimizador
          <img src={photoUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-foreground-muted">
            <ImageSquare size={20} aria-hidden="true" />
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground group-hover:text-brand-ink">
          {listing.title}
        </span>
        {priceLabel && (
          <span className="numeric mt-0.5 block text-sm font-bold text-brand">
            {priceLabel}
          </span>
        )}
        <span className="mt-0.5 block text-xs text-foreground-muted">
          {COPY.thread.viewListing}
        </span>
      </span>

      <ArrowUpRight
        size={16}
        aria-hidden="true"
        className="shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand"
      />
    </Link>
  );
}
