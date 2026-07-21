import Link from "next/link";
import { ArrowRight, MapPin, ShieldCheck, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, CardMedia } from "@/components/ui";
import { cn } from "@/lib/utils";
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
  /** SOLO presente si hay verification_check found_active vinculado. */
  verification: VerificationView | null;
  publisher: PublisherView;
}

/** Vivienda → acento azul del módulo (para el CTA en píldora). */
const ACCENT = "var(--accent-vivienda)";

/**
 * CTA en píldora con el acento del módulo (feedback cliente 2026-07-21: el botón
 * deja de ser gris). El acento va en el borde/tinte y en la flecha; el texto
 * queda en `text-foreground` para no arriesgar contraste (criterio AA de
 * EntityKindChip). Server-safe: sólo un Link.
 */
function AccentLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        borderColor: `color-mix(in oklab, ${ACCENT} 45%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${ACCENT} 12%, transparent)`,
      }}
      className={cn(
        "mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-semibold text-foreground",
        "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
    >
      {children}
      <ArrowRight size={16} aria-hidden="true" style={{ color: ACCENT }} />
    </Link>
  );
}

/**
 * Card de listing de VIVIENDA (§4.b/§4.d). Rediseño 2026-07-21: la foto es
 * protagonista y el título/precio/zona van SOBRE su borde inferior (overlayBottom
 * de CardMedia, legible por el scrim); la banda de verificación queda arriba.
 * Debajo, sólo el publicador con su Trust Score y un CTA en píldora con acento.
 * Estructura claramente distinta a un post social.
 *
 * Se usa también en /propiedades y en matching: el contrato (ListingCardModel)
 * no cambia.
 */
export function ListingCard({ listing }: { listing: ListingCardModel }) {
  return (
    <BezelCard
      variant={listing.verification ? "success" : "default"}
      coreClassName="overflow-hidden p-0"
    >
      <article aria-label={listing.title}>
        <CardMedia
          src={listing.photoUrl}
          fallbackSrc={FALLBACK_PHOTO}
          aspect="video"
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
          {listing.publisher?.type === "member" ? (
            <div className="flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
              <span className="truncate">{listing.publisher.displayName}</span>
              <PublisherTrust
                displayName={listing.publisher.displayName}
                firstName={firstNameOf(listing.publisher.displayName)}
                score={listing.publisher.score}
                level={listing.publisher.level}
                signals={listing.publisher.signals}
                size="inline"
              />
            </div>
          ) : listing.publisher?.type === "external" ? (
            <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
              <Storefront size={16} aria-hidden="true" className="shrink-0" />
              {COPY.list.externalPublisher(listing.publisher.name)}
            </p>
          ) : null}

          <AccentLink href={`/propiedades/${listing.id}`}>{COPY.list.viewDetails}</AccentLink>
        </div>
      </article>
    </BezelCard>
  );
}
