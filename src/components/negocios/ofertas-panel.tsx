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
 * ── EL VACÍO CUENTA QUÉ VA A APARECER, Y NO PROMETE UN BOTÓN QUE NO EXISTE ──
 * Hoy la pestaña nace vacía por dos motivos distintos y los dos legítimos: la
 * migración 0106 todavía no está aplicada, y el composer que escribe una oferta
 * se está cableando en paralelo. El estado vacío explica de qué se va a llenar y
 * ofrece el único camino que SÍ existe hoy para un dueño de negocio —su ficha—
 * en vez de un "Publicar oferta" que no llevaría a ningún lado.
 *
 * Y nunca dice "no hay ofertas" cuando lo que pasa es que todas vencieron: la
 * consulta ya filtra por vigencia, así que este vacío es honesto en los dos
 * casos — no hay NINGUNA oferta vigente ahora mismo.
 */

const COPY = {
  vacioTitulo: "Todavía no hay ofertas vigentes",
  vacioMensaje:
    "Acá van a aparecer los descuentos, cupones, promos, menús y paquetes que publiquen los negocios de tu comunidad, con la fecha hasta la que valen.",
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
