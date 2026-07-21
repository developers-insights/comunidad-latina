"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CalendarBlank,
  MapPin,
  ShieldCheck,
  ShieldWarning,
  ShoppingBagOpen,
  Sparkle,
  Storefront,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import { Badge, BottomSheet, Button, CardMedia, buttonVariants } from "@/components/ui";
import { PublisherTrust, FALLBACK_PHOTO } from "@/components/listings";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import type { FeedListingModel } from "./helpers";

import type { Icon } from "@phosphor-icons/react";

const KIND_ICON: Record<string, Icon> = {
  business: Storefront,
  professional: UserGear,
  event: CalendarBlank,
  job: Briefcase,
  product: ShoppingBagOpen,
  creator_gig: Sparkle,
};

/** Kinds con página real de detalle → el CTA saca del feed (§4.b). */
const DETAIL_ROUTE: Record<string, (id: string) => string> = {
  event: (id) => `/eventos/${id}`,
  professional: (id) => `/profesionales/${id}`,
  product: (id) => `/marketplace/${id}`,
  creator_gig: (id) => `/creadores/${id}`,
};

/** Acento del módulo por vertical (para el CTA). Cubre los kinds de esta card. */
const LISTING_ACCENT: Record<string, string> = {
  business: "var(--accent-negocios)",
  professional: "var(--accent-profesionales)",
  event: "var(--accent-eventos)",
  job: "var(--accent-feed)",
  product: "var(--accent-marketplace)",
  creator_gig: "var(--accent-creadores)",
};

/**
 * CTA en píldora con el ACENTO del módulo (feedback cliente 2026-07-21: el botón
 * "Ver detalles" deja de ser gris). El acento viaja en el borde/tinte y en la
 * flecha; el texto queda en `text-foreground` para no arriesgar contraste (mismo
 * criterio AA que EntityKindChip — el amarillo de negocios no sería AA como texto).
 */
function AccentCta({
  accent,
  href,
  onClick,
  children,
}: {
  accent: string;
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const className = cn(
    "mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-semibold text-foreground",
    "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.98]",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
  );
  const style = {
    borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${accent} 12%, transparent)`,
  };
  const inner = (
    <>
      {children}
      <ArrowRight size={16} aria-hidden="true" style={{ color: accent }} />
    </>
  );
  return href ? (
    <Link href={href} className={className} style={style}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className} style={style}>
      {inner}
    </button>
  );
}

/**
 * Card de listing NO-property para el feed (§4.b): misma gramática visual que la
 * ListingCard de VIVIENDA. Rediseño 2026-07-21: la foto es protagonista y el
 * título/precio/zona van SOBRE su borde inferior (overlayBottom de CardMedia,
 * legible por el scrim); el kind y la verificación quedan arriba. El único CTA
 * pasa a ser una píldora con el acento del vertical.
 *
 * CTA: eventos/profesionales/productos/gigs navegan a su detalle real;
 * negocios/empleos (sin página propia) abren un BottomSheet con la info completa.
 * Los listings de propiedades usan SIEMPRE la ListingCard real.
 */
export function FeedListingCard({ listing }: { listing: FeedListingModel }) {
  const [open, setOpen] = useState(false);
  const KindIcon = KIND_ICON[listing.kind] ?? Storefront;
  const kindLabel = COPY.listing.kindLabel[listing.kind] ?? listing.kind;
  const detailHref = DETAIL_ROUTE[listing.kind]?.(listing.id) ?? null;
  const accent = LISTING_ACCENT[listing.kind] ?? "var(--accent-feed)";

  return (
    <>
      <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel">
        <article
          aria-label={listing.title}
          className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface shadow-[inset_0_1px_0_var(--cl-bezel-highlight)]"
        >
          <CardMedia
            src={listing.photoUrl}
            fallbackSrc={FALLBACK_PHOTO}
            aspect="video"
            quality={62}
            overlayTopLeft={
              <>
                <Badge variant="neutral">
                  <KindIcon size={13} aria-hidden="true" />
                  {kindLabel}
                </Badge>
                {listing.verifiedDateLabel && (
                  <Badge variant="success">
                    <ShieldCheck size={13} aria-hidden="true" />
                    {COPY.listing.verifiedChip(listing.verifiedDateLabel)}
                  </Badge>
                )}
              </>
            }
            overlayBottom={
              <div>
                <h3 className="font-display text-base font-bold leading-snug text-on-media line-clamp-2">
                  {listing.title}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  {listing.priceLabel && (
                    <span className="numeric text-lg font-bold text-on-media">
                      {listing.priceLabel}
                    </span>
                  )}
                  {listing.areaLabel && (
                    <span className="flex items-center gap-1 text-sm text-on-media/85">
                      <MapPin size={14} aria-hidden="true" className="shrink-0" />
                      {listing.areaLabel}
                    </span>
                  )}
                </div>
              </div>
            }
          />

          <div className="flex flex-col gap-2.5 p-4">
            {listing.publisherTrust ? (
              <div className="flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
                <span className="truncate">{listing.publisherTrust.displayName}</span>
                <PublisherTrust
                  displayName={listing.publisherTrust.displayName}
                  firstName={listing.publisherTrust.firstName}
                  score={listing.publisherTrust.score}
                  level={listing.publisherTrust.level}
                  signals={listing.publisherTrust.signals}
                  size="inline"
                />
              </div>
            ) : listing.publisherName ? (
              <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
                <Storefront size={16} aria-hidden="true" className="shrink-0" />
                {COPY.listing.externalPublisher(listing.publisherName)}
              </p>
            ) : null}

            {detailHref ? (
              <AccentCta accent={accent} href={detailHref}>
                {COPY.listing.viewDetails}
              </AccentCta>
            ) : (
              <AccentCta accent={accent} onClick={() => setOpen(true)}>
                {COPY.listing.viewDetails}
              </AccentCta>
            )}
          </div>
        </article>
      </div>

      {!detailHref && (
        <BottomSheet open={open} onClose={() => setOpen(false)} title={listing.title}>
          <div className="flex flex-col gap-4 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">
                <KindIcon size={13} aria-hidden="true" />
                {kindLabel}
              </Badge>
              {listing.areaLabel && (
                <span className="flex items-center gap-1 text-sm text-foreground-secondary">
                  <MapPin size={14} aria-hidden="true" />
                  {listing.areaLabel}
                </span>
              )}
            </div>

            {listing.priceLabel && (
              <p className="numeric text-2xl font-bold text-brand">{listing.priceLabel}</p>
            )}

            {listing.description && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-secondary">
                {listing.description}
              </p>
            )}

            {(listing.publisherTrust || listing.publisherName) && (
              <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                  {COPY.listing.sheetPublishedBy}
                </p>
                {listing.publisherTrust ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {listing.publisherTrust.displayName}
                    </span>
                    <PublisherTrust
                      displayName={listing.publisherTrust.displayName}
                      firstName={listing.publisherTrust.firstName}
                      score={listing.publisherTrust.score}
                      level={listing.publisherTrust.level}
                      signals={listing.publisherTrust.signals}
                      size="inline"
                    />
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-foreground-secondary">
                    {COPY.listing.externalPublisher(listing.publisherName ?? "")}
                  </p>
                )}
              </div>
            )}

            <div
              role="note"
              aria-label="Aviso de seguridad"
              className="flex items-start gap-3 rounded-lg bg-warning-bg p-4"
            >
              <ShieldWarning
                size={22}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-warning"
              />
              <p className="text-sm text-foreground">{COPY.listing.sheetSafety}</p>
            </div>

            {listing.kind === "business" && (
              <Link
                href="/negocios"
                className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
              >
                {COPY.listing.sheetDirectoryCta}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            )}

            <Button variant="secondary" className="w-full" onClick={() => setOpen(false)}>
              {COPY.listing.sheetClose}
            </Button>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
