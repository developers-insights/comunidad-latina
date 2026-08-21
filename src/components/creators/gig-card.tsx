import Link from "next/link";
import { CaretRight, Lightning, MapPin, Storefront, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, CardMedia, MediaScrimBottom } from "@/components/ui";
import { PublisherTrust } from "@/components/listings";
import { firstNameOf, type PublisherView } from "@/components/listings";
import { PhotoTap } from "@/components/media/photo-tap";
import { cn } from "@/lib/utils";
import { ApplySheet } from "./apply-sheet";
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
  /**
   * TODAS las fotos del aviso ya resueltas (allPhotoUrls) — el visor las pasa
   * de una. Opcional: quien todavía no las manda cae a `photoUrl`.
   */
  photos?: string[];
  category: string | null;
  /** DERIVADO de la fecha de entrega (deadline_days ≤ 7). Se calcula al armar el
   *  modelo (page.tsx), no es un toggle manual — ver isUrgentDeadline(). */
  urgent: boolean;
  /** Propuestas recibidas — se muestra solo si viene (vista del dueño). */
  applicationsCount?: number | null;
  publisher: PublisherView;
}

/**
 * Card de oportunidad del feed de Creadores (§ feedback cliente 2026-07-24: se
 * siente RED SOCIAL). Foto vertical 4:5 (o fallback violeta con el ícono de la
 * categoría); el título, el presupuesto y la zona viven en una franja de VIDRIO
 * sobre la foto. Chip "Urgente" (entrega ≤ 7 días) y marco featured. Debajo,
 * confianza del publicador y una píldora con el acento del módulo.
 *
 * TRES GESTOS, TRES RESULTADOS. Tocar la FOTO abre el visor con las fotos del
 * aviso (feedback 2026-07-26); el fallback violeta NO es tocable, no hay foto
 * que mirar. "Postularme" RESUELVE acá mismo —abre la hoja de propuesta sobre el
 * listado, sin cambiar la URL— y "Ver trabajo" es el único que navega, ahora
 * como acción secundaria (cliente 2026-08-20: "mientras menos pasos mejor").
 */
export interface GigCardProps {
  gig: GigCardModel;
  /**
   * QUIÉN MIRA — `profiles.id` de la sesión, o `null` si nadie entró.
   *
   * Existe para una sola cosa: no ofrecerle a nadie postularse a su propio
   * aviso. Antes eso se deducía de `applicationsCount` ("no me pasaron el
   * conteo → no sos el dueño"), que es una inferencia sobre un campo de
   * PRESENTACIÓN y encima al revés de como funciona el listado: en `/creadores`
   * ese conteo no viaja para nadie, así que el dueño veía el botón igual
   * (revisión 2026-08-20).
   *
   * Esconder el botón NO es la barrera: la barrera es `applyToGig`, que compara
   * `created_by` contra la sesión en el servidor. Acá sólo se evita ofrecer algo
   * que va a rebotar.
   */
  viewerId?: string | null;
}

export function GigCard({ gig, viewerId = null }: GigCardProps) {
  const category = gigCategoryMeta(gig.category);
  const CategoryIcon = category.Icon;
  const photos = gig.photos?.length ? gig.photos : gig.photoUrl ? [gig.photoUrl] : [];

  // `publisher.profileId` ES `listings.created_by` (lo arma la página del
  // listado): una identidad de verdad, no un conteo.
  const isOwnGig =
    Boolean(viewerId) && gig.publisher?.type === "member" && gig.publisher.profileId === viewerId;

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
        <PhotoTap photos={photos} label={COPY.openPhotos(gig.title)} authorName={gig.title}>
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
        </PhotoTap>

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
                profileId={gig.publisher.profileId}
              />
            </div>
          ) : gig.publisher?.type === "external" ? (
            <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
              <Storefront size={16} aria-hidden="true" className="shrink-0" />
              {gig.publisher.name}
            </p>
          ) : null}

          {/* DOS ACCIONES, UNA SOLA PRIMARIA (cliente 2026-08-20: "mientras
              menos pasos mejor"). La hoja de propuesta ya existía y estaba
              montada un nivel más abajo, en `/creadores/[id]`: acá se monta
              sobre la card y la URL no cambia. "Ver trabajo" no se elimina —
              baja de rango a texto tranquilo, para quien quiera leer el
              presupuesto completo, la fecha de entrega y al negocio antes de
              escribir. La píldora con el acento del módulo se retira: dos
              píldoras del mismo peso serían dos primarias, y entonces no hay
              ninguna. */}
          {/* A nadie se le ofrece postularse a su propio trabajo. La condición
              es la IDENTIDAD de quien mira contra la de quien publicó — ver
              `viewerId` arriba. */}
          {!isOwnGig && <ApplySheet gigId={gig.id} gigTitle={gig.title} surface="card" />}

          <Link
            href={`/creadores/${gig.id}`}
            aria-label={`${COPY.feed.viewGig}: ${gig.title}`}
            className={cn(
              "flex min-h-11 w-full items-center justify-center gap-1 rounded-full px-4",
              "text-sm font-semibold text-foreground-secondary",
              "transition-[background-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
              "hover:bg-surface-subtle hover:text-foreground active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            {COPY.feed.viewGig}
            <CaretRight size={15} aria-hidden="true" className="shrink-0 opacity-70" />
          </Link>
        </div>
      </article>
    </BezelCard>
  );
}
