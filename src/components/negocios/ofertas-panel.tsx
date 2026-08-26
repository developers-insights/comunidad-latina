import Link from "next/link";
import { CaretDown, Ticket } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import type { OfertaVista } from "@/lib/negocios/ofertas-modelo";
import { cn } from "@/lib/utils";
import { OfertaCard } from "./oferta-card";

/**
 * Pestaña "Ofertas" (spec cliente: descuentos, cupones, promociones por tiempo
 * limitado, menús y paquetes).
 *
 * ── EL VACÍO CUENTA QUÉ VA A APARECER, Y CÓMO SE LLENA ──────────────────────
 * Ya no hay ningún motivo estructural para que esté vacía: `post_offers` existe
 * con su RLS desde la 0106 y el composer que la ESCRIBE existe desde el bloque
 * "Es una oferta" (`components/negocios/oferta-composer.tsx`), que aparece al
 * publicar firmando con una ficha de negocio. Así que el vacío pasó a decir
 * exactamente eso: de qué se va a llenar, y por dónde entra quien tiene un
 * negocio.
 *
 * El botón sigue apuntando al directorio y no a "Publicar oferta": este panel
 * lo mira CUALQUIERA —la enorme mayoría no tiene negocio— y un CTA de alta para
 * todos sería ofrecerle una pantalla de dueño a quien vino a buscar un
 * descuento. Quien sí tiene negocio publica desde el "+" de siempre.
 *
 * Y nunca dice "no hay ofertas" cuando lo que pasa es que todas vencieron: la
 * consulta ya filtra por vigencia, así que este vacío es honesto en los dos
 * casos — no hay NINGUNA oferta vigente ahora mismo.
 */

const COPY = {
  vacioTitulo: "Todavía no hay ofertas vigentes",
  vacioMensaje:
    "Acá van a aparecer los descuentos, cupones, promos, menús y paquetes que publiquen los negocios de tu comunidad, con la fecha hasta la que valen. ¿Tenés un negocio? Publicá con su nombre desde el «+» y marcá «Es una oferta».",
  vacioCta: "Ver los negocios",
  verMas: "Ver más ofertas",
} as const;

export interface OfertasPanelProps {
  ofertas: OfertaVista[];
  /** `null` = sin sesión: Guardar y Contactar abren la hoja en vez de escribir. */
  viewerId: string | null;
  /** Ids de post que este viewer ya guardó (una sola consulta para toda la página). */
  guardadas: ReadonlySet<string>;
  /** Href de la próxima página (keyset), o null si no hay más. */
  nextHref: string | null;
  className?: string;
}

export function OfertasPanel({
  ofertas,
  viewerId,
  guardadas,
  nextHref,
  className,
}: OfertasPanelProps) {
  if (ofertas.length === 0) {
    return (
      <EmptyState
        className={className}
        icon={<Ticket />}
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
      {ofertas.map((oferta) => (
        <OfertaCard
          key={oferta.postId}
          oferta={oferta}
          viewerId={viewerId}
          guardada={guardadas.has(oferta.postId)}
        />
      ))}

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
