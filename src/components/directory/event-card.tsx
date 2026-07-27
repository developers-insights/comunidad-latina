import { CalendarBlank, MapPin } from "@phosphor-icons/react/dist/ssr";
import { AccentLink, BezelCard } from "@/components/ui";
import { PublisherTrust } from "@/components/listings";
import { PhotoTap } from "@/components/media/photo-tap";
import type { TrustLevel, TrustSignal } from "@/components/trust";
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
  /**
   * TODAS las fotos del evento ya resueltas (allPhotoUrls) — el visor las pasa
   * de una. Opcional: quien todavía no las manda cae a `photoUrl`.
   */
  photos?: string[];
  /** Organizador miembro → SIEMPRE con su TrustScoreBadge (regla: autor con señal). */
  publisherTrust: EventPublisherTrust | null;
  /** Organizador externo (publisher_name, sin cuenta) — fuente atribuida, sin trust. */
  publisherName: string | null;
}

/** Acento rojo del módulo (solo decorativo) para la píldora de acción. */
const ACCENT = "var(--accent-eventos)";

/**
 * Card de evento (§ feedback cliente 2026-07-24: se siente RED SOCIAL, no
 * clasificado). Foto vertical 4:5 protagonista; el título, la fecha y la zona
 * viven en una franja de VIDRIO sobre la foto (glass). Debajo, sólo el
 * organizador con su confianza y una píldora con el acento del módulo. Acento
 * --accent-eventos (rojo), decorativo.
 *
 * DOS destinos, uno por gesto (feedback 2026-07-26, regla de Vivienda extendida
 * a todo el directorio): tocar la FOTO abre el visor con las fotos del evento;
 * la píldora "Ver evento" es la única que navega al detalle.
 */
export function EventCard({ event }: { event: EventCardModel }) {
  const dateText = event.date
    ? `${event.date.full}${event.date.time ? ` · ${event.date.time}` : ""}`
    : COPY.events.dateToConfirm;

  const photos = event.photos?.length ? event.photos : event.photoUrl ? [event.photoUrl] : [];

  return (
    <BezelCard coreClassName="overflow-hidden p-0">
      <article aria-label={event.title}>
        <PhotoTap photos={photos} label={COPY.openPhotos(event.title)} authorName={event.title}>
          <DirectoryMedia
            src={event.photoUrl}
            accent="eventos"
            icon={CalendarBlank}
            aspect="portrait"
            overlayTopLeft={
              event.free || event.date?.isPast ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-3 py-1.5 text-xs font-bold text-foreground backdrop-blur-sm">
                  {event.free ? COPY.events.freeChip : COPY.events.pastLabel}
                </span>
              ) : undefined
            }
            overlayBottom={
              <div>
                <h3 className="font-display text-base font-bold leading-snug line-clamp-2">
                  {event.title}
                </h3>
                <p className="mt-1 flex items-center gap-1.5 text-sm">
                  <CalendarBlank size={14} aria-hidden="true" className="shrink-0 opacity-80" />
                  <span className="min-w-0 truncate">{dateText}</span>
                </p>
                {event.venueArea && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm opacity-90">
                    <MapPin size={14} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 truncate">{event.venueArea}</span>
                  </p>
                )}
              </div>
            }
          />
        </PhotoTap>

        <div className="flex flex-col gap-2.5 p-4">
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

          <AccentLink accent={ACCENT} href={`/eventos/${event.id}`} ariaLabel={event.title}>
            {COPY.events.viewEvent}
          </AccentLink>
        </div>
      </article>
    </BezelCard>
  );
}
