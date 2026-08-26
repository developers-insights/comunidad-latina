import Link from "next/link";
import { CaretDown, Storefront } from "@phosphor-icons/react/dist/ssr";
import { FeedListingCard, PostCard } from "@/components/feed";
import type { BusinessFeedItem } from "@/lib/negocios/publicaciones";
import { EmptyState, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Pestaña "Publicaciones" de Negocios (spec cliente: «el newsfeed sólo de
 * contenido comercial — fotos, videos, textos, menús, productos y servicios,
 * anuncios, y tarjetas de eventos y de empleos vinculadas a sus módulos»).
 *
 * Renderiza con los MISMOS componentes que el feed principal: `<PostCard>` para
 * las publicaciones y `<FeedListingCard>` para los eventos y empleos vinculados.
 * Cero UI nueva inventada para leer algo que ya se lee en otras cuatro
 * pantallas, y cualquier mejora futura de esas tarjetas aparece acá sin que
 * nadie la porte.
 *
 * ── POR QUÉ DOS COMPONENTES Y NO UNO ────────────────────────────────────────
 * Porque son dos cosas distintas y la spec las nombra por separado: las
 * publicaciones son contenido del negocio, y las tarjetas de evento y de empleo
 * son avisos de OTRO módulo que ese negocio publicó. Aplanar el evento a un post
 * con foto lo dejaría sin su fecha y sin su "Quiero ir", que es justamente lo
 * que alguien vino a tocar. La mezcla cronológica la resuelve la consulta
 * (`lib/negocios/publicaciones.ts`); acá sólo se elige qué tarjeta pintar.
 *
 * ── EL VACÍO SIGUE SIENDO POSIBLE, PERO YA NO ES ESTRUCTURAL ────────────────
 * Este bloque decía que el composer que escribe `posts.entity_listing_id` "se
 * estaba cableando en paralelo" y que publicar como negocio "todavía no es una
 * pantalla". Las dos cosas dejaron de ser ciertas: el selector de autoría del
 * composer (`components/feed/autoria-selector.tsx`) ofrece firmar como negocio,
 * `AUTORIA_KINDS` incluye `business` y `crearPost` persiste el vínculo tras
 * validarlo contra la base. O sea que esta pestaña se llena sola en cuanto un
 * dueño publica firmando con su ficha.
 *
 * El vacío se conserva igual, porque una comunidad recién arrancada sí lo va a
 * ver: cuenta qué va a aparecer acá y manda al directorio. Lo que NO hace es
 * ofrecer "Publicar como mi negocio" como atajo — el composer vive en el feed
 * y esa firma sólo existe para quien administra una ficha, así que un botón
 * acá llevaría a la mayoría a una pantalla donde la opción no aparece.
 */

const COPY = {
  vacioTitulo: "Todavía no hay publicaciones de negocios",
  vacioMensaje:
    "Acá van a aparecer las novedades que compartan los comercios de tu comunidad: fotos y videos, menús del día, productos y servicios, y los eventos y empleos que publiquen.",
  vacioCta: "Ver los negocios",
  verMas: "Ver más publicaciones",
} as const;

export interface PublicacionesPanelProps {
  /** Publicaciones y tarjetas vinculadas, YA mezcladas por fecha. */
  items: BusinessFeedItem[];
  tenantId: string;
  viewerId: string | null;
  /** Href de la próxima página (keyset), o null si no hay más. */
  nextHref: string | null;
  className?: string;
}

export function PublicacionesPanel({
  items,
  tenantId,
  viewerId,
  nextHref,
  className,
}: PublicacionesPanelProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        className={className}
        icon={<Storefront />}
        title={COPY.vacioTitulo}
        message={COPY.vacioMensaje}
        action={
          <Link href="/negocios" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {COPY.vacioCta}
          </Link>
        }
      />
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {items.map((item) =>
        item.type === "post" ? (
          <PostCard
            key={`post:${item.id}`}
            post={item.post}
            tenantId={tenantId}
            viewerId={viewerId}
          />
        ) : (
          <FeedListingCard key={`listing:${item.id}`} listing={item.listing} />
        ),
      )}

      {nextHref && (
        <Link
          href={nextHref}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
        >
          {COPY.verMas}
          <CaretDown size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
