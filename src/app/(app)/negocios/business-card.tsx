import Link from "next/link";
import { ArrowRight, MapPin, SealCheck, Storefront } from "@phosphor-icons/react/dist/ssr";
import { ACCENT_CHIP_CLASS, DirectoryMedia } from "@/components/directory";
import { PublisherTrust } from "@/components/listings";
import { Badge, BezelCard, Chip, Skeleton, buttonVariants } from "@/components/ui";
import { PhotoTap } from "@/components/media/photo-tap";
import type { TrustLevel, TrustSignal } from "@/components/trust";
import { cn } from "@/lib/utils";

const COPY = {
  viewBusiness: "Ver negocio",
  publishedBy: "Publicado por",
  /** Mismo término que la burbuja de venta de la sección ("Conocer Presencia
   *  Verificada"): el badge de la card usa el nombre real de la feature, no un
   *  genérico "Verificado" que no calzaría con lo que el dueño compró. */
  verifiedBadge: "Presencia verificada",
  /** Tocar la foto la abre en el visor; "Ver negocio" abre el perfil. */
  openPhotos: (title: string) => `Ver fotos de ${title}`,
} as const;

/**
 * Trust Score del dueño del negocio, en la forma que pide el componente
 * CANÓNICO `PublisherTrust` (@/components/listings, el mismo que usan
 * propiedades/profesionales/eventos/negocios/[id]). Antes esta card tenía su
 * propio `BusinessTrustBadge`, que reimplementaba el mismo botón+hoja que
 * `PublisherTrust` ya resuelve — dos componentes para un mismo patrón es
 * exactamente el tipo de deriva que rompe "cuando una sección está bien, la
 * hermana debe estar igual". Unificado: `business-trust-badge.tsx` se borró.
 */
export interface OwnerTrust {
  /** Nombre completo — el sheet usa el nombre de pila (firstName). */
  displayName: string;
  firstName: string;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
  /** SIN id no hay botón "Ver el perfil de…" dentro del desglose. */
  profileId: string | null;
}

export interface BusinessCardModel {
  id: string;
  title: string;
  description: string | null;
  categoryLabel: string | null;
  areaLabel: string | null;
  /** Primera foto ya resuelta (firstPhotoUrl) o null — DirectoryMedia cae al fallback del módulo. */
  photoUrl: string | null;
  /**
   * TODAS las fotos del negocio ya resueltas (allPhotoUrls) — el visor las pasa
   * de una. Opcional: sin ella cae a `photoUrl`.
   */
  photos?: string[];
  ownerTrust: OwnerTrust | null;
  /** Fuente externa (seed/API) sin cuenta — solo se muestra si no hay ownerTrust. */
  publisherName: string | null;
  /** `listings.store_verified` — espejo público de `business_accounts.verified_presence`. */
  storeVerified: boolean;
}

/**
 * Card de negocio (§ feedback cliente 2026-07-19: misma estética que
 * Propiedades — foto 16:9 grande, contenido debajo, 1 solo CTA). Acento
 * --accent-negocios (amarillo/dorado), solo decorativo.
 *
 * "VER NEGOCIO" AHORA NAVEGA (call del 29/7, 1:05: "si le das ver al negocio…
 * tiene que salir profile del negocio, toda la información del negocio").
 * Antes abría un BottomSheet con tres datos —era el desvío documentado por no
 * haber página propia—; hoy `/negocios/[id]` existe y tiene la información
 * completa, las publicaciones del negocio y sus botones de contacto. Al irse la
 * hoja se fue también el único estado del componente: esta card volvió a ser
 * server, o sea cero JS por cada negocio del listado.
 *
 * Mismo reparto de gestos que el resto de las cards (feedback 2026-07-26):
 * tocar la FOTO abre el visor a pantalla completa; "Ver negocio" abre el
 * perfil. Sin foto, el gradiente del módulo no es tocable.
 */
export function BusinessCard({ business }: { business: BusinessCardModel }) {
  const photos = business.photos?.length
    ? business.photos
    : business.photoUrl
      ? [business.photoUrl]
      : [];

  return (
    <BezelCard coreClassName="overflow-hidden p-0">
      <article aria-label={business.title}>
        <PhotoTap
          photos={photos}
          label={COPY.openPhotos(business.title)}
          authorName={business.title}
        >
          <DirectoryMedia
            src={business.photoUrl}
            accent="negocios"
            icon={Storefront}
            // Mismo lugar que el sello de licencia de vivienda/profesionales
            // (overlayTopLeft, Badge success + ícono+texto — nunca solo color,
            // §3.2): acá el sello es SealCheck + "Presencia verificada" porque
            // `store_verified` es OTRA verificación (la del negocio, no una
            // licencia con fecha) y usar el mismo ícono confundiría las dos.
            overlayTopLeft={
              business.storeVerified ? (
                <Badge variant="success">
                  <SealCheck size={13} weight="fill" aria-hidden="true" />
                  {COPY.verifiedBadge}
                </Badge>
              ) : undefined
            }
          />
        </PhotoTap>

        <div className="flex flex-col gap-2.5 p-4">
          {business.categoryLabel && (
            <Chip className={cn("self-start", ACCENT_CHIP_CLASS.negocios)}>
              {business.categoryLabel}
            </Chip>
          )}

          <h3 className="font-display text-lg font-bold leading-snug text-foreground">
            {business.title}
          </h3>

          {business.areaLabel && (
            <p className="flex items-center gap-1.5 text-sm text-foreground-secondary">
              <MapPin size={16} aria-hidden="true" className="shrink-0" />
              {business.areaLabel}
            </p>
          )}

          {business.ownerTrust ? (
            <div className="flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
              <span className="truncate">{business.ownerTrust.displayName}</span>
              <PublisherTrust
                displayName={business.ownerTrust.displayName}
                firstName={business.ownerTrust.firstName}
                score={business.ownerTrust.score}
                level={business.ownerTrust.level}
                signals={business.ownerTrust.signals}
                size="inline"
                profileId={business.ownerTrust.profileId}
              />
            </div>
          ) : (
            business.publisherName && (
              <p className="text-sm text-foreground-muted">
                {COPY.publishedBy} {business.publisherName}
              </p>
            )
          )}

          {/* El nombre accesible dice A QUÉ negocio lleva: en una lista de
              treinta tarjetas, treinta enlaces que dicen "Ver negocio" no
              orientan a nadie que navegue por enlaces. */}
          <Link
            href={`/negocios/${business.id}`}
            aria-label={`${COPY.viewBusiness}: ${business.title}`}
            className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-1 w-full")}
          >
            {COPY.viewBusiness}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </article>
    </BezelCard>
  );
}

/** Silueta de <BusinessCard> — shimmer, nunca spinner (§5.2). */
export function BusinessCardSkeleton() {
  return (
    <div className="rounded-xl bg-bezel-shell p-1.5 shadow-bezel" aria-hidden="true">
      <div className="overflow-hidden rounded-[calc(var(--radius-xl)-6px)] bg-surface">
        <Skeleton className="aspect-video w-full rounded-none" />
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function BusinessListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Cargando negocios">
      {Array.from({ length: count }, (_, index) => (
        <BusinessCardSkeleton key={index} />
      ))}
      <span className="sr-only">Cargando negocios…</span>
    </div>
  );
}
