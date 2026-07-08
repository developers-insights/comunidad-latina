"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Check, X } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui";
import {
  resolveListingReview,
  type DomainActionState,
} from "@/app/admin/dominio/actions";
import { PendingButton } from "./pending-button";

/** Preview compacto de un aviso en revisión + Aprobar/Rechazar (panel Dominio). */

export interface ListingReviewData {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  areaLabel: string | null;
  price: string | null;
  photosCount: number;
  createdAt: string;
}

/**
 * Solo estos kinds tienen página real de detalle (misma tabla que el
 * DETAIL_ROUTE del feed). Cada ruta filtra por su kind y hace notFound()
 * si no coincide — un href genérico daría 404. business/job no tienen
 * detalle propio → sin link (la card ya muestra título/descripción/precio).
 */
const DETAIL_ROUTE: Record<string, (id: string) => string> = {
  property: (id) => `/propiedades/${id}`,
  professional: (id) => `/profesionales/${id}`,
  event: (id) => `/eventos/${id}`,
};

const COPY = {
  approve: "Aprobar",
  reject: "Rechazar",
  open: "Ver aviso",
  photos: (n: number) => (n === 1 ? "1 foto" : `${n} fotos`),
  kindLabel: {
    property: "Vivienda",
    business: "Negocio",
    professional: "Profesional",
    event: "Evento",
    job: "Trabajo",
  } as Record<string, string>,
} as const;

const initialState: DomainActionState = { status: "idle" };

export function ListingReviewItem({ listing }: { listing: ListingReviewData }) {
  const [state, formAction] = useActionState(resolveListingReview, initialState);
  const detailHref = DETAIL_ROUTE[listing.kind]?.(listing.id) ?? null;

  return (
    <article className="rounded-lg border border-border bg-surface p-4 shadow-xs">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant="brand">{COPY.kindLabel[listing.kind] ?? listing.kind}</Badge>
        {listing.price && (
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {listing.price}
          </span>
        )}
        <span className="ml-auto text-xs text-foreground-muted">
          {COPY.photos(listing.photosCount)}
        </span>
      </header>

      <h3 className="mt-2 text-sm font-semibold text-foreground">{listing.title}</h3>
      {listing.areaLabel && (
        <p className="text-xs text-foreground-muted">{listing.areaLabel}</p>
      )}
      {listing.description && (
        <p className="mt-1.5 line-clamp-3 break-words text-sm text-foreground-secondary">
          {listing.description}
        </p>
      )}

      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.message}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {detailHref && (
          <Link
            href={detailHref}
            className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            {COPY.open}
          </Link>
        )}
        <form action={formAction} className="ml-auto flex gap-2">
          <input type="hidden" name="listingId" value={listing.id} />
          <PendingButton
            variant="outline"
            size="sm"
            name="decision"
            value="reject"
            type="submit"
            className="border-danger/40 text-danger hover:bg-danger-bg"
          >
            <X size={16} aria-hidden="true" />
            {COPY.reject}
          </PendingButton>
          <PendingButton
            variant="secondary"
            size="sm"
            name="decision"
            value="approve"
            type="submit"
          >
            <Check size={16} aria-hidden="true" />
            {COPY.approve}
          </PendingButton>
        </form>
      </div>
    </article>
  );
}
