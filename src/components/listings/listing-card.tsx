"use client";

import { MapPin, ShieldCheck, Storefront } from "@phosphor-icons/react/dist/ssr";
import { AccentLink, Badge, BezelCard, CardMedia } from "@/components/ui";
// Import DIRECTO al módulo del visor, no al barril de @/components/feed: ese
// barril reexporta feed-listing-card, que a su vez importa de @/components/listings
// — pasar por él armaría un ciclo entre los dos módulos.
import { useMediaViewer } from "@/components/feed/media-viewer";
import { COPY } from "./copy";
import {
  FALLBACK_PHOTO,
  firstNameOf,
  type PublisherView,
  type VerificationView,
} from "./helpers";
import { PublisherTrust } from "./publisher-trust";

export interface ListingCardModel {
  id: string;
  title: string;
  priceLabel: string | null;
  areaLabel: string | null;
  photoUrl: string | null;
  /**
   * TODAS las fotos del aviso, ya resueltas a URL pública — el visor las pasa
   * de una. Opcional: quien todavía no las manda (p. ej. el merge del feed)
   * cae a `photoUrl`, así el tap abre igual con la única foto que tiene.
   */
  photos?: string[];
  /** SOLO presente si hay verification_check found_active vinculado. */
  verification: VerificationView | null;
  publisher: PublisherView;
}

/** Vivienda → acento azul del módulo (para el CTA en píldora). */
const ACCENT = "var(--accent-vivienda)";

/** Foto grande tocable = red social (§4.d, feedback 2026-07-24 / 2026-07-26). */
const MEDIA_BUTTON =
  "group block w-full text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.99]";

/**
 * Card de listing de VIVIENDA (§4.b/§4.d). La foto es protagonista en 4:5
 * (retrato, como el feed y el resto del directorio desde 37fea5c) y el
 * título/precio/zona viven en la franja de VIDRIO sobre su borde inferior; la
 * banda de verificación queda arriba. Debajo, sólo el publicador con su Trust
 * Score y la píldora de acento.
 *
 * DOS destinos, uno por gesto (feedback 2026-07-26 — "la foto es la foto"):
 *  - tocar la FOTO abre el visor a pantalla completa con TODAS las fotos del
 *    aviso (mismo visor del feed: swipe, contador, arrastrar para cerrar);
 *  - la píldora "Ver detalles" es la que navega al aviso.
 *
 * Se usa también en /propiedades y en el feed: `photos` es opcional, así que el
 * contrato viejo (sólo `photoUrl`) sigue funcionando sin tocar a quien la llama.
 */
export function ListingCard({ listing }: { listing: ListingCardModel }) {
  const viewer = useMediaViewer();
  const href = `/propiedades/${listing.id}`;

  // Fotos del visor: las que vengan; si no, la única que conocemos.
  const photos =
    listing.photos && listing.photos.length > 0
      ? listing.photos
      : listing.photoUrl
        ? [listing.photoUrl]
        : [];

  function openPhotos() {
    if (photos.length === 0) return; // sin fotos reales no abrimos un visor del fallback
    viewer.open({
      items: photos.map((url) => ({ kind: "image" as const, url })),
      authorName: listing.title,
    });
  }

  return (
    <BezelCard
      variant={listing.verification ? "success" : "default"}
      coreClassName="overflow-hidden p-0"
    >
      <article aria-label={listing.title}>
        <button
          type="button"
          onClick={openPhotos}
          aria-label={COPY.list.openPhotos(listing.title)}
          className={MEDIA_BUTTON}
        >
          <CardMedia
            src={listing.photoUrl}
            fallbackSrc={FALLBACK_PHOTO}
            aspect="portrait"
            quality={62}
            overlayTopLeft={
              listing.verification ? (
                <Badge variant="success">
                  <ShieldCheck size={13} weight="fill" aria-hidden="true" />
                  {COPY.list.verifiedChip(listing.verification.dateLabel)}
                </Badge>
              ) : undefined
            }
            overlayBottom={
              <div>
                <h3 className="font-display text-base font-bold leading-snug line-clamp-2">
                  {listing.title}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  {listing.priceLabel && (
                    <span className="numeric text-lg font-bold">{listing.priceLabel}</span>
                  )}
                  {listing.areaLabel && (
                    <span className="flex items-center gap-1 text-sm opacity-90">
                      <MapPin size={14} aria-hidden="true" className="shrink-0" />
                      {listing.areaLabel}
                    </span>
                  )}
                  {photos.length > 1 && (
                    <span className="numeric text-sm opacity-80">
                      {COPY.list.photoCount(photos.length)}
                    </span>
                  )}
                </div>
              </div>
            }
          />
        </button>

        <div className="flex flex-col gap-2.5 p-4">
          {listing.publisher?.type === "member" ? (
            <div className="flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
              <span className="truncate">{listing.publisher.displayName}</span>
              <PublisherTrust
                displayName={listing.publisher.displayName}
                firstName={firstNameOf(listing.publisher.displayName)}
                score={listing.publisher.score}
                level={listing.publisher.level}
                signals={listing.publisher.signals}
                profileId={listing.publisher.profileId}
                size="inline"
              />
            </div>
          ) : listing.publisher?.type === "external" ? (
            <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
              <Storefront size={16} aria-hidden="true" className="shrink-0" />
              {COPY.list.externalPublisher(listing.publisher.name)}
            </p>
          ) : null}

          <AccentLink accent={ACCENT} href={href} ariaLabel={listing.title}>
            {COPY.list.viewDetails}
          </AccentLink>
        </div>
      </article>
    </BezelCard>
  );
}
