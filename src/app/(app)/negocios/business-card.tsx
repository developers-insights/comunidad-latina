"use client";

import { useState } from "react";
import { ArrowRight, MapPin, Storefront } from "@phosphor-icons/react/dist/ssr";
import { ACCENT_CHIP_CLASS, DirectoryMedia } from "@/components/directory";
import { BezelCard, BottomSheet, Button, Chip, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { BusinessTrustBadge, type OwnerTrust } from "./business-trust-badge";

const COPY = {
  viewBusiness: "Ver negocio",
  publishedBy: "Publicado por",
  close: "Cerrar",
} as const;

export interface BusinessCardModel {
  id: string;
  title: string;
  description: string | null;
  categoryLabel: string | null;
  areaLabel: string | null;
  /** Primera foto ya resuelta (firstPhotoUrl) o null — DirectoryMedia cae al fallback del módulo. */
  photoUrl: string | null;
  ownerTrust: OwnerTrust | null;
  /** Fuente externa (seed/API) sin cuenta — solo se muestra si no hay ownerTrust. */
  publisherName: string | null;
}

/**
 * Card de negocio (§ feedback cliente 2026-07-19: misma estética que
 * Propiedades — foto 16:9 grande, contenido debajo, 1 solo CTA). Negocios no
 * tiene página de detalle propia (mismo desvío documentado que
 * <FeedListingCard>): el CTA abre un BottomSheet con la info completa en vez
 * de navegar. Acento --accent-negocios (amarillo/dorado), solo decorativo.
 */
export function BusinessCard({ business }: { business: BusinessCardModel }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <BezelCard coreClassName="overflow-hidden p-0">
        <article aria-label={business.title}>
          <DirectoryMedia src={business.photoUrl} accent="negocios" icon={Storefront} />

          <div className="flex flex-col gap-2.5 p-4">
            {business.categoryLabel && (
              <Chip className={cn("self-start", ACCENT_CHIP_CLASS.negocios)}>
                {business.categoryLabel}
              </Chip>
            )}

            <h3 className="font-display text-lg font-bold leading-snug text-foreground">
              {business.title}
            </h3>

            {business.areaLabel && (
              <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
                <MapPin size={16} aria-hidden="true" className="shrink-0" />
                {business.areaLabel}
              </p>
            )}

            {business.ownerTrust ? (
              <BusinessTrustBadge trust={business.ownerTrust} />
            ) : (
              business.publisherName && (
                <p className="text-sm text-foreground-muted">
                  {COPY.publishedBy} {business.publisherName}
                </p>
              )
            )}

            <Button
              type="button"
              variant="secondary"
              size="md"
              className="mt-1 w-full"
              onClick={() => setOpen(true)}
            >
              {COPY.viewBusiness}
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
        </article>
      </BezelCard>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={business.title}>
        <div className="flex flex-col gap-4 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            {business.categoryLabel && (
              <Chip className={ACCENT_CHIP_CLASS.negocios}>{business.categoryLabel}</Chip>
            )}
            {business.areaLabel && (
              <span className="flex items-center gap-1 text-sm text-foreground-secondary">
                <MapPin size={14} aria-hidden="true" />
                {business.areaLabel}
              </span>
            )}
          </div>

          {business.description && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-secondary">
              {business.description}
            </p>
          )}

          {business.ownerTrust ? (
            <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                {COPY.publishedBy}
              </p>
              <div className="mt-2">
                <BusinessTrustBadge trust={business.ownerTrust} />
              </div>
            </div>
          ) : (
            business.publisherName && (
              <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                  {COPY.publishedBy}
                </p>
                <p className="mt-2 text-sm text-foreground-secondary">{business.publisherName}</p>
              </div>
            )
          )}

          <Button variant="secondary" className="w-full" onClick={() => setOpen(false)}>
            {COPY.close}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

/** Silueta de <BusinessCard> — shimmer, nunca spinner (§5.2). */
export function BusinessCardSkeleton() {
  return (
    <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel" aria-hidden="true">
      <div className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface">
        <Skeleton className="aspect-video w-full rounded-none" />
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function BusinessListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Cargando negocios">
      {Array.from({ length: count }, (_, index) => (
        <BusinessCardSkeleton key={index} />
      ))}
      <span className="sr-only">Cargando negocios…</span>
    </div>
  );
}
