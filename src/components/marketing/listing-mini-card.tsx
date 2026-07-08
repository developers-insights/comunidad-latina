import Image from "next/image";
import Link from "next/link";
import { HouseLine, MapPin, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Badge } from "@/components/ui";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { COPY, PUBLISHER_LABELS } from "./copy";

const SUPABASE_ORIGIN = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

/** Solo assets locales o del Storage de Supabase pasan por next/image. */
function isOptimizableSrc(src: string): boolean {
  return (
    src.startsWith("/") ||
    (SUPABASE_ORIGIN.length > 0 && src.startsWith(`${SUPABASE_ORIGIN}/`))
  );
}

/** Forma plana de listing para las cards compactas de la landing. */
export interface ListingMiniData {
  id: string;
  title: string;
  priceAmount: number | null;
  priceCurrency: string;
  pricePeriod: string | null;
  areaLabel: string | null;
  photoUrl: string | null;
  publisherKind: string | null;
  /**
   * Verificación found_active vinculada, o null → AUSENCIA total de banda
   * (§11: jamás un badge rojo "no verificado").
   */
  verification: { registry: string; checkedAt: string } | null;
}

/**
 * Card compacta de propiedad para la landing. Double-Bezel (tarjeta de
 * confianza §2.5). La banda de verificación usa el copy legal literal §11.
 */
export function ListingMiniCard({
  listing,
  className,
}: {
  listing: ListingMiniData;
  className?: string;
}) {
  const publisherLabel = listing.publisherKind
    ? (PUBLISHER_LABELS[listing.publisherKind] ?? listing.publisherKind)
    : null;

  return (
    <Link
      href={`/propiedades/${listing.id}`}
      className={cn(
        "group block h-full rounded-xl transition-transform duration-(--duration-base) ease-(--ease-out-premium)",
        "hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <BezelCard className="h-full" coreClassName="flex h-full flex-col overflow-hidden p-0">
        {listing.photoUrl ? (
          isOptimizableSrc(listing.photoUrl) ? (
            <div className="relative aspect-[16/10] w-full">
              <Image
                src={listing.photoUrl}
                alt=""
                fill
                sizes="(max-width: 640px) 80vw, 320px"
                className="object-cover"
              />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- URL externa de seed/API: host fuera del allowlist de next/image
            <img
              src={listing.photoUrl}
              alt=""
              loading="lazy"
              className="aspect-[16/10] w-full object-cover"
            />
          )
        ) : (
          <div
            aria-hidden="true"
            className="flex aspect-[16/10] w-full items-center justify-center bg-surface-subtle"
          >
            <HouseLine size={32} weight="light" className="text-foreground-muted" />
          </div>
        )}

        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-baseline justify-between gap-2">
            {listing.priceAmount !== null && (
              <p className="numeric text-lg font-bold text-foreground">
                {formatMoney(listing.priceAmount, { currency: listing.priceCurrency })}
                {listing.pricePeriod === "month" && (
                  <span className="text-sm font-medium text-foreground-muted">
                    {COPY.listings.perMonth}
                  </span>
                )}
              </p>
            )}
            {publisherLabel && <Badge>{publisherLabel}</Badge>}
          </div>

          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
            {listing.title}
          </h3>

          {listing.areaLabel && (
            <p className="inline-flex items-center gap-1 text-xs text-foreground-muted">
              <MapPin size={14} aria-hidden="true" />
              {listing.areaLabel}
            </p>
          )}

          {listing.verification && (
            <div className="mt-auto rounded-sm bg-success-bg px-2.5 py-2 text-xs leading-snug">
              <p className="flex items-start gap-1.5 font-medium text-success-ink">
                <SealCheck size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  Licencia activa según {listing.verification.registry} al{" "}
                  {formatDate(listing.verification.checkedAt, { style: "long" })}.
                </span>
              </p>
              <p className="mt-1 text-foreground-secondary">
                Esto NO garantiza conducta — nunca envíes dinero por adelantado.
              </p>
            </div>
          )}
        </div>
      </BezelCard>
    </Link>
  );
}
