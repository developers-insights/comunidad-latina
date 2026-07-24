import Link from "next/link";
import { Lightning, MapPin, Storefront, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { AccentLink, BezelCard, CardMedia, MediaScrimBottom } from "@/components/ui";
import { PublisherTrust } from "@/components/listings";
import { firstNameOf, type PublisherView } from "@/components/listings";
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
  /** DERIVADO de la fecha de entrega (deadline_days ≤ 7). Se calcula al armar el
   *  modelo (page.tsx), no es un toggle manual — ver isUrgentDeadline(). */
  urgent: boolean;
  /** Propuestas recibidas — se muestra solo si viene (vista del dueño). */
  applicationsCount?: number | null;
  publisher: PublisherView;
}

/** Acento violeta del módulo (solo decorativo) para la píldora de acción. */
const ACCENT = "var(--accent-creadores)";

const MEDIA_LINK =
  "group block focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.99]";

/**
 * Card de oportunidad del feed de Creadores (§ feedback cliente 2026-07-24: se
 * siente RED SOCIAL). Foto vertical 4:5 (o fallback violeta con el ícono de la
 * categoría); el título, el presupuesto y la zona viven en una franja de VIDRIO
 * sobre la foto. Chip "Urgente" (entrega ≤ 7 días) y marco featured. Tap en la
 * foto abre el trabajo; debajo, confianza del publicador y una píldora con el
 * acento del módulo.
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

  const band = (
    <div>
      <h3 className="font-display text-base font-bold leading-snug line-clamp-2">{gig.title}</h3>
      {gig.budgetLabel && (
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="text-xs font-medium opacity-80">{COPY.feed.budgetPrefix}</span>
          <span className="numeric text-lg font-bold">{gig.budgetLabel}</span>
        </p>
      )}
      {gig.areaLabel && (
        <p className="mt-0.5 flex items-center gap-1.5 text-sm opacity-90">
          <MapPin size={14} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 truncate">{gig.areaLabel}</span>
        </p>
      )}
    </div>
  );

  return (
    <BezelCard variant={gig.urgent ? "featured" : "default"} coreClassName="overflow-hidden p-0">
      <article aria-label={gig.title}>
        <Link href={`/creadores/${gig.id}`} aria-label={gig.title} className={MEDIA_LINK}>
          {gig.photoUrl ? (
            <CardMedia
              src={gig.photoUrl}
              fallbackSrc={gig.photoUrl}
              aspect="portrait"
              overlayTopRight={urgentChip}
              overlayBottom={band}
            />
          ) : (
            // Fallback elegante: gradiente violeta del módulo + ícono de categoría.
            <div
              className="relative flex aspect-[4/5] w-full items-center justify-center"
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
              <MediaScrimBottom>{band}</MediaScrimBottom>
            </div>
          )}
        </Link>

        <div className="flex flex-col gap-2.5 p-4">
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

          <AccentLink accent={ACCENT} href={`/creadores/${gig.id}`}>
            {COPY.feed.viewGig}
          </AccentLink>
        </div>
      </article>
    </BezelCard>
  );
}
