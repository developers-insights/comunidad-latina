import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin, ShieldCheck, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import {
  FALLBACK_PHOTO,
  firstNameOf,
  isOptimizableSrc,
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

/**
 * Card de listing (§4.b/§4.d): foto 16:9 + precio destacado + banda de
 * verificación (por ausencia si no hay) + Trust Score del publicador +
 * 1 solo CTA. Estructura de card claramente distinta a un post social.
 */
export function ListingCard({ listing }: { listing: ListingCardModel }) {
  const photo = listing.photoUrl ?? FALLBACK_PHOTO;

  return (
    <BezelCard
      variant={listing.verification ? "success" : "default"}
      coreClassName="overflow-hidden p-0"
    >
      <article aria-label={listing.title}>
        <div className="relative aspect-video w-full bg-surface-subtle">
          {isOptimizableSrc(photo) ? (
            <Image
              src={photo}
              alt=""
              fill
              sizes="(max-width: 512px) 100vw, 512px"
              quality={62}
              className="object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- URL externa de seed/API: host fuera del allowlist de next/image
            <img
              src={photo}
              alt=""
              loading="lazy"
              className="absolute inset-0 size-full object-cover"
            />
          )}
        </div>

        <div className="flex flex-col gap-2.5 p-4">
          {listing.verification && (
            <Badge variant="success" className="self-start">
              <ShieldCheck size={13} weight="fill" aria-hidden="true" />
              {COPY.list.verifiedChip(listing.verification.dateLabel)}
            </Badge>
          )}

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

          <Link
            href={`/propiedades/${listing.id}`}
            className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-1 w-full")}
          >
            {COPY.list.viewDetails}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </article>
    </BezelCard>
  );
}
