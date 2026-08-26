import Link from "next/link";
import { CaretRight, MapPin, SealCheck, Storefront } from "@phosphor-icons/react/dist/ssr";
import { ACCENT_CHIP_CLASS, DirectoryMedia } from "@/components/directory";
import { PublisherTrust } from "@/components/listings";
import { InlineMessageCta } from "@/components/listings/inline-message-cta";
import { AccionesRapidas, EstadoAperturaChip, type AccionRapida } from "@/components/negocios";
import { Estrellas } from "@/components/resenas";
import { Badge, BezelCard, Chip, Skeleton, buttonVariants } from "@/components/ui";
import { PhotoTap } from "@/components/media/photo-tap";
import type { TrustLevel, TrustSignal } from "@/components/trust";
import type { EstadoApertura } from "@/lib/horarios";
import { RESENAS_COPY, formatearPromedio, type ResumenPuntaje } from "@/lib/resenas";
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
  /** Placeholder del composer: distinto al genérico de avisos ("¿sigue
   *  disponible?" no se le pregunta a una peluquería). */
  messagePlaceholder: "Hola, quería consultarte por tu negocio.",
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
  /**
   * Calificaciones (`listing_review_stats`, 0093), resueltas EN LOTE para toda
   * la página. `cantidad = 0` ⇒ "Sin reseñas todavía", nunca un cero.
   */
  rating: ResumenPuntaje;
  /**
   * Estado de apertura ya calculado en el servidor (`lib/negocios/horarios.ts`)
   * con la zona horaria DEL NEGOCIO. `null` = no cargó horarios: no se afirma
   * nada, ni abierto ni cerrado.
   */
  apertura: EstadoApertura | null;
  /**
   * "Llamar" y "Cómo llegar" que YA pasaron los dos filtros del servidor: plan
   * con botones habilitados (`canUseActionButtons`) y valor cargado y saneado
   * (`ctaHref`). Vacío ⇒ no se pinta ningún botón muerto.
   */
  acciones: AccionRapida[];
  /** `true` si hay dueño con cuenta y NO es quien está mirando: hay a quién escribirle. */
  puedeRecibirMensajes: boolean;
  /** Lo que sabía el servidor al renderizar; sólo decide si el primer toque abre la hoja de sesión. */
  isLoggedIn: boolean;
}

/**
 * Card de negocio del directorio (§ feedback cliente 2026-07-19: misma estética
 * que Propiedades — foto 16:9 grande, contenido debajo). Acento
 * --accent-negocios (amarillo/dorado), solo decorativo.
 *
 * ── LO QUE LA SPEC PIDE EN CADA TARJETA, Y DE DÓNDE SALE ────────────────────
 *   · logo y nombre    → listings.photos + listings.title
 *   · categoría        → attrs.category (set curado en ./categories.ts)
 *   · ciudad           → listings.area_label
 *   · insignia         → listings.store_verified (0039)
 *   · calificación     → listing_review_stats (0093), en lote
 *   · abierto/cerrado  → listing_hours + slots (0093), en lote, en la zona del
 *                        negocio
 *   · Ver negocio · Mensaje · Llamar · Cómo llegar
 *
 * ── LOS CUATRO BOTONES A 375 px: TRES FILAS, NO UNA ─────────────────────────
 * El ancho útil dentro de la card en un teléfono chico es ~303 px (375 − 32 de
 * página − 12 del bisel − 32 del padding). Cuatro botones en fila dejan 68 px
 * cada uno: "Cómo llegar" se corta y ninguno llega a un target cómodo. Y no se
 * arregla con scroll horizontal — la §5 prohíbe que una lista se navegue de
 * costado para llegar a una acción.
 *
 * El reparto va por JERARQUÍA, que además es el patrón que ya estrenó JobCard:
 *
 *   1. MENSAJE, ancho completo. Es lo que la persona vino a hacer y se resuelve
 *      ACÁ MISMO: el composer se abre sobre la tarjeta y la lista no se mueve
 *      (cliente 2026-08-20, "mientras menos pasos mejor"). Sólo aparece si hay
 *      dueño con cuenta y no es la propia ficha.
 *   2. LLAMAR + CÓMO LLEGAR, en una grilla que se adapta a cuántos hay. Son
 *      acciones de plan pago con valor cargado; si falta uno, el otro ocupa
 *      todo el ancho en vez de quedar flotando.
 *   3. VER NEGOCIO, texto tranquilo de ancho completo. No desaparece: baja de
 *      rango. Y cuando NO hay ninguna acción arriba (negocio de seed, plan
 *      gratuito), vuelve a ser el botón primario que era — una card sin ninguna
 *      acción destacada no tiene ninguna.
 *
 * Tocar la FOTO abre el visor a pantalla completa (feedback 2026-07-26). Sin
 * foto, el gradiente del módulo no es tocable.
 */
export function BusinessCard({ business }: { business: BusinessCardModel }) {
  const photos = business.photos?.length
    ? business.photos
    : business.photoUrl
      ? [business.photoUrl]
      : [];

  const promedio = formatearPromedio(business.rating.promedio);
  const hayAccionesArriba = business.puedeRecibirMensajes || business.acciones.length > 0;

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
            // (overlayTopLeft, ícono + texto — nunca solo color, §3.2), pero
            // OTRO ícono y OTRO color, porque es otro hecho.
            //
            // `store_verified` es el espejo público de un PLAN PAGO
            // (`business_accounts.verified_presence`), no una verificación de
            // identidad ni una licencia con fecha. La app reserva el par
            // verde + escudo para lo que se verifica de la persona (ver
            // `IdentityBadge` y `SellerIdentityBadge`) y usa azul + sello para
            // lo que se contrata. Quien compra decide mirando esta insignia: si
            // dice confianza verificada y en realidad dice plan al día, engaña.
            overlayTopLeft={
              business.storeVerified ? (
                <Badge variant="info">
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

          {/* Calificación y estado de apertura comparten renglón cuando entran y
              bajan solos cuando no: son los dos datos que deciden si vale la
              pena ir, y separarlos en dos líneas fijas estiraba la card 20px por
              cada negocio sin horario cargado. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {business.rating.cantidad > 0 ? (
              <span className="flex items-center gap-1.5">
                <Estrellas
                  valor={business.rating.promedio}
                  size={14}
                  etiqueta={RESENAS_COPY.promedioAria(promedio ?? "", business.rating.cantidad)}
                />
                <span className="numeric text-sm text-foreground-secondary">
                  {promedio} ({business.rating.cantidad})
                </span>
              </span>
            ) : (
              // "Sin reseñas todavía" y NO un cero: un negocio nuevo no vale
              // menos que uno con dos estrellas — no se sabe nada de él, que es
              // otra cosa (mismo criterio que ResumenPuntajeCard).
              <span className="text-sm text-foreground-muted">{RESENAS_COPY.sinPuntaje}</span>
            )}
            <EstadoAperturaChip estado={business.apertura} />
          </div>

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

          {business.puedeRecibirMensajes && (
            <InlineMessageCta
              listingId={business.id}
              isLoggedIn={business.isLoggedIn}
              nextPath="/negocios"
              placeholder={COPY.messagePlaceholder}
              className="mt-1"
            />
          )}

          <AccionesRapidas
            listingId={business.id}
            subject={business.title}
            acciones={business.acciones}
          />

          {/* El nombre accesible dice A QUÉ negocio lleva: en una lista de
              treinta tarjetas, treinta enlaces que dicen "Ver negocio" no
              orientan a nadie que navegue por enlaces. */}
          <Link
            href={`/negocios/${business.id}`}
            aria-label={`${COPY.viewBusiness}: ${business.title}`}
            className={
              hayAccionesArriba
                ? cn(
                    "flex min-h-11 w-full items-center justify-center gap-1 rounded-full px-4",
                    "text-sm font-semibold text-foreground-secondary",
                    "transition-[background-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                    "hover:bg-surface-subtle hover:text-foreground active:scale-[0.98]",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  )
                : cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-1 w-full")
            }
          >
            {COPY.viewBusiness}
            <CaretRight size={15} aria-hidden="true" className="shrink-0 opacity-70" />
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
          {/* Calificación + estado de apertura: la silueta los reserva para que
              la card no crezca 24px cuando llegan los datos (cero CLS). */}
          <Skeleton className="h-4 w-2/3" />
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
