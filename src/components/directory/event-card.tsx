import Link from "next/link";
import { ArrowRight, CalendarBlank, MapPin } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, buttonVariants } from "@/components/ui";
import { PublisherTrust } from "@/components/listings";
import type { TrustLevel, TrustSignal } from "@/components/trust";
import { cn } from "@/lib/utils";
import { ACCENT_ICON_CLASS } from "./accent";
import { COPY } from "./copy";
import type { EventDateParts } from "./helpers";
import { DirectoryMedia } from "./module-media";

/** Trust Score del organizador con cuenta, resuelto en batch server-side. */
export interface EventPublisherTrust {
  displayName: string;
  firstName: string;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
}

export interface EventCardModel {
  id: string;
  title: string;
  venueArea: string | null;
  /** null → fecha a confirmar (nunca inventamos una). */
  date: EventDateParts | null;
  free: boolean;
  /** Primera foto ya resuelta (firstPhotoUrl) o null — DirectoryMedia cae al fallback del módulo. */
  photoUrl: string | null;
  /** Organizador miembro → SIEMPRE con su TrustScoreBadge (regla: autor con señal). */
  publisherTrust: EventPublisherTrust | null;
  /** Organizador externo (publisher_name, sin cuenta) — fuente atribuida, sin trust. */
  publisherName: string | null;
}

/**
 * Card de evento (§ feedback cliente 2026-07-19: misma estética que
 * Propiedades — foto 16:9 grande, contenido debajo, 1 solo CTA). La fecha
 * manda pero ahora vive como cápsula sobre la foto en vez de bloque lateral;
 * la línea completa (día/hora) se conserva en el contenido para no perder
 * información. Acento --accent-eventos (rojo), solo decorativo.
 */
export function EventCard({ event }: { event: EventCardModel }) {
  return (
    <BezelCard coreClassName="overflow-hidden p-0">
      <article aria-label={event.title}>
        <DirectoryMedia
          src={event.photoUrl}
          accent="eventos"
          icon={CalendarBlank}
          overlayTopLeft={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-3 py-1.5 text-xs font-bold text-foreground backdrop-blur-sm">
              <CalendarBlank size={14} weight="bold" aria-hidden="true" className={ACCENT_ICON_CLASS.eventos} />
              {event.date ? `${event.date.day} ${event.date.month}` : COPY.events.dateToConfirm}
            </span>
          }
        />

        <div className="flex flex-col gap-2.5 p-4">
          {(event.free || event.date?.isPast) && (
            <div className="flex flex-wrap items-center gap-2">
              {event.free && <Badge variant="success">{COPY.events.freeChip}</Badge>}
              {event.date?.isPast && <Badge variant="neutral">{COPY.events.pastLabel}</Badge>}
            </div>
          )}

          <h3 className="font-display text-lg font-bold leading-snug text-foreground">
            {event.title}
          </h3>

          <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
            <CalendarBlank size={16} aria-hidden="true" className="shrink-0" />
            {event.date ? (
              <>
                {event.date.full}
                {event.date.time && <span className="numeric"> · {event.date.time}</span>}
              </>
            ) : (
              COPY.events.dateToConfirm
            )}
          </p>

          {event.venueArea && (
            <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
              <MapPin size={16} aria-hidden="true" className="shrink-0" />
              {event.venueArea}
            </p>
          )}

          {event.publisherTrust ? (
            <div className="flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
              <span className="truncate">{event.publisherTrust.displayName}</span>
              <PublisherTrust
                displayName={event.publisherTrust.displayName}
                firstName={event.publisherTrust.firstName}
                score={event.publisherTrust.score}
                level={event.publisherTrust.level}
                signals={event.publisherTrust.signals}
                size="inline"
              />
            </div>
          ) : event.publisherName ? (
            <p className="truncate text-sm text-foreground-muted">{event.publisherName}</p>
          ) : null}

          <Link
            href={`/eventos/${event.id}`}
            className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-1 w-full")}
          >
            {COPY.events.viewEvent}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </article>
    </BezelCard>
  );
}
