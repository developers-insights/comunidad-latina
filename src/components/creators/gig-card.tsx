import Link from "next/link";
import { ArrowRight, Lightning, MapPin, Storefront, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, CardMedia, buttonVariants } from "@/components/ui";
import { PublisherTrust } from "@/components/listings";
import { firstNameOf, type PublisherView } from "@/components/listings";
import { cn } from "@/lib/utils";
import { gigCategoryMeta } from "./categories";
import { COPY } from "./copy";

export interface GigCardModel {
  id: string;
  title: string;
  /** Presupuesto ya formateado ("$1,000") o null. */
  budgetLabel: string | null;
  areaLabel: string | null;
  /** Primera foto del aviso (listing-photos) o null → fallback violeta. */
  photoUrl: string | null;
  category: string | null;
  urgent: boolean;
  /** Propuestas recibidas — se muestra solo si viene (vista del dueño). */
  applicationsCount?: number | null;
  publisher: PublisherView;
}

/**
 * Card grande del feed de oportunidades (estética Propiedades: foto grande,
 * feed alegre). Foto o fallback con gradiente violeta + ícono de categoría,
 * chip de categoría, presupuesto destacado, chip "Urgente" (+ marco featured),
 * zona, publicador con Trust Score y un único CTA "Ver trabajo".
 */
export function GigCard({ gig }: { gig: GigCardModel }) {
  const category = gigCategoryMeta(gig.category);
  const CategoryIcon = category.Icon;

  const urgentChip = gig.urgent ? (
    <span className="inline-flex items-center gap-1 rounded-full cl-print-fill bg-media-scrim px-2.5 py-1 text-xs font-bold text-on-media backdrop-blur-sm">
      <Lightning size={13} weight="fill" aria-hidden="true" />
      {COPY.feed.urgentChip}
    </span>
  ) : null;

  return (
    <BezelCard variant={gig.urgent ? "featured" : "default"} coreClassName="overflow-hidden p-0">
      <article aria-label={gig.title}>
        {gig.photoUrl ? (
          <CardMedia
            src={gig.photoUrl}
            fallbackSrc={gig.photoUrl}
            aspect="video"
            overlayTopRight={urgentChip}
          />
        ) : (
          // Fallback elegante: gradiente violeta del módulo + ícono de categoría.
          <div
            className="relative flex aspect-video w-full items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in oklab, var(--accent-creadores) 78%, black), var(--accent-creadores))",
            }}
          >
            <CategoryIcon size={64} weight="fill" aria-hidden="true" className="text-on-media/85" />
            {urgentChip && (
              <div className="absolute right-2.5 top-2.5 flex flex-wrap justify-end gap-1.5">
                {urgentChip}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2.5 p-4">
          <h3 className="font-display text-lg font-bold leading-snug text-foreground">{gig.title}</h3>

          {gig.budgetLabel && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-medium text-foreground-secondary">
                {COPY.feed.budgetPrefix}
              </span>
              <span className="numeric text-2xl font-bold text-brand">{gig.budgetLabel}</span>
            </div>
          )}

          {gig.areaLabel && (
            <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
              <MapPin size={16} aria-hidden="true" className="shrink-0" />
              {gig.areaLabel}
            </p>
          )}

          {typeof gig.applicationsCount === "number" && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground-secondary">
              <UsersThree size={16} aria-hidden="true" className="shrink-0" />
              {COPY.feed.proposalsCount(gig.applicationsCount)}
            </p>
          )}

          {gig.publisher?.type === "member" ? (
            <div className="flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
              <span className="truncate">{gig.publisher.displayName}</span>
              <PublisherTrust
                displayName={gig.publisher.displayName}
                firstName={firstNameOf(gig.publisher.displayName)}
                score={gig.publisher.score}
                level={gig.publisher.level}
                signals={gig.publisher.signals}
                size="inline"
              />
            </div>
          ) : gig.publisher?.type === "external" ? (
            <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
              <Storefront size={16} aria-hidden="true" className="shrink-0" />
              {gig.publisher.name}
            </p>
          ) : null}

          <Link
            href={`/creadores/${gig.id}`}
            className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-1 w-full")}
          >
            {COPY.feed.viewGig}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </article>
    </BezelCard>
  );
}
