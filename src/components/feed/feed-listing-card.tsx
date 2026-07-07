"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CalendarBlank,
  MapPin,
  ShieldCheck,
  ShieldWarning,
  Storefront,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import { Badge, BottomSheet, Button, buttonVariants } from "@/components/ui";
import { PublisherTrust } from "@/components/listings";
import { isOptimizableSrc } from "@/components/listings/helpers";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import type { FeedListingModel } from "./helpers";

import type { Icon } from "@phosphor-icons/react";

const KIND_ICON: Record<string, Icon> = {
  business: Storefront,
  professional: UserGear,
  event: CalendarBlank,
  job: Briefcase,
};

/** Kinds con página real de detalle → el CTA saca del feed (§4.b). */
const DETAIL_ROUTE: Record<string, (id: string) => string> = {
  event: (id) => `/eventos/${id}`,
  professional: (id) => `/profesionales/${id}`,
};

/**
 * Card de listing NO-property para el feed (§4.b): misma gramática visual que
 * la ListingCard de VIVIENDA (foto 16:9 + precio + verificación + trust).
 * CTA: eventos/profesionales navegan a su detalle real; negocios/empleos
 * (sin página de detalle propia) abren un BottomSheet con la info completa
 * — desvío documentado en la entrega.
 * Los listings de propiedades usan SIEMPRE la ListingCard real.
 */
export function FeedListingCard({ listing }: { listing: FeedListingModel }) {
  const [open, setOpen] = useState(false);
  const KindIcon = KIND_ICON[listing.kind] ?? Storefront;
  const kindLabel = COPY.listing.kindLabel[listing.kind] ?? listing.kind;
  const detailHref = DETAIL_ROUTE[listing.kind]?.(listing.id) ?? null;

  return (
    <>
      <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel">
        <article
          aria-label={listing.title}
          className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface shadow-[inset_0_1px_0_var(--cl-bezel-highlight)]"
        >
          {listing.photoUrl && (
            <div className="relative aspect-video w-full bg-surface-subtle">
              {isOptimizableSrc(listing.photoUrl) ? (
                <Image
                  src={listing.photoUrl}
                  alt=""
                  fill
                  sizes="(max-width: 512px) 100vw, 512px"
                  className="object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- URL externa fuera del allowlist de next/image
                <img
                  src={listing.photoUrl}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                />
              )}
            </div>
          )}

          <div className="flex flex-col gap-2.5 p-4">
            <div className="flex flex-wrap items-center gap-2">
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
            </div>

            <h3 className="font-display text-lg font-bold leading-snug text-foreground">
              {listing.title}
            </h3>

            {listing.priceLabel && (
              <p className="numeric text-2xl font-bold text-brand">{listing.priceLabel}</p>
            )}

            {listing.areaLabel && (
              <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
                <MapPin size={16} aria-hidden="true" className="shrink-0" />
                {listing.areaLabel}
              </p>
            )}

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
              <Link
                href={detailHref}
                className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-1 w-full")}
              >
                {COPY.listing.viewDetails}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ) : (
              <Button
                variant="secondary"
                size="md"
                className="mt-1 w-full"
                onClick={() => setOpen(true)}
              >
                {COPY.listing.viewDetails}
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
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
