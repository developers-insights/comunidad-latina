import Link from "next/link";
import { CalendarBlank, MapPin } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard } from "@/components/ui";
import { PublisherTrust } from "@/components/listings";
import type { TrustLevel, TrustSignal } from "@/components/trust";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import type { EventDateParts } from "./helpers";

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
  /** Organizador miembro → SIEMPRE con su TrustScoreBadge (regla: autor con señal). */
  publisherTrust: EventPublisherTrust | null;
  /** Organizador externo (publisher_name, sin cuenta) — fuente atribuida, sin trust. */
  publisherName: string | null;
}

/**
 * Card editorial de evento (§4.b): la fecha manda — bloque día/mes a la
 * izquierda, título y zona a la derecha. Toda la card es un destino
 * (anti-scroll §1.1.⑤): un tap → detalle. El link va como overlay (stretched
 * link) para que el TrustScoreBadge del organizador —que abre su desglose—
 * pueda vivir adentro sin anidar interactivos (button dentro de anchor).
 */
export function EventCard({ event }: { event: EventCardModel }) {
  return (
    <div className="group relative">
      <BezelCard coreClassName="flex items-stretch gap-4 p-4">
        <article aria-label={event.title} className="contents">
          <div
            aria-hidden="true"
            className={cn(
              "flex w-16 shrink-0 flex-col items-center justify-center rounded-lg py-2",
              event.date && !event.date.isPast
                ? "bg-brand-50 text-brand-700"
                : "bg-surface-subtle text-foreground-muted",
            )}
          >
            {event.date ? (
              <>
                <span className="numeric font-display text-2xl font-bold leading-none">
                  {event.date.day}
                </span>
                <span className="mt-1 text-xs font-semibold tracking-wide">
                  {event.date.month}
                </span>
              </>
            ) : (
              <CalendarBlank size={26} />
            )}
          </div>

          <div className="min-w-0 flex-1 py-0.5">
            <p className="text-xs font-semibold text-foreground-secondary">
              {event.date ? (
                <>
                  {event.date.full}
                  {event.date.time && <span className="numeric"> · {event.date.time}</span>}
                </>
              ) : (
                COPY.events.dateToConfirm
              )}
            </p>
            <h3 className="mt-1 font-display text-base font-bold leading-snug text-foreground group-hover:text-brand-700">
              {event.title}
            </h3>
            {event.venueArea && (
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-foreground-secondary">
                <MapPin size={15} aria-hidden="true" className="shrink-0" />
                {event.venueArea}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {event.free && <Badge variant="success">{COPY.events.freeChip}</Badge>}
              {event.date?.isPast && <Badge variant="neutral">{COPY.events.pastLabel}</Badge>}
              {event.publisherTrust ? (
                <span className="relative z-10 flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-xs text-foreground-muted">
                    {event.publisherTrust.displayName}
                  </span>
                  <PublisherTrust
                    displayName={event.publisherTrust.displayName}
                    firstName={event.publisherTrust.firstName}
                    score={event.publisherTrust.score}
                    level={event.publisherTrust.level}
                    signals={event.publisherTrust.signals}
                    size="inline"
                  />
                </span>
              ) : event.publisherName ? (
                <span className="truncate text-xs text-foreground-muted">
                  {event.publisherName}
                </span>
              ) : null}
            </div>
          </div>
        </article>
      </BezelCard>

      {/* Overlay: un tap en cualquier parte de la card → detalle (§1.1.⑤). */}
      <Link
        href={`/eventos/${event.id}`}
        aria-label={event.title}
        className="absolute inset-0 rounded-[var(--radius-xl)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]"
      />
    </div>
  );
}
