import Link from "next/link";
import { CheckCircle, PencilSimple, Wrench } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * LOS SERVICIOS QUE OFRECE UN NEGOCIO — sección de su página pública
 * =============================================================================
 *
 * Pedido del cliente (call 3/9, 59:00–1:00:30): «falta poder … agregar los
 * servicios que da cada perfil». Es la respuesta a la primera pregunta de quien
 * entra a una constructora o a una barbería: qué me puede resolver.
 *
 * ── DOS VACÍOS DISTINTOS, PORQUE SON DOS PERSONAS DISTINTAS ─────────────────
 * A quien VISITA no le sirve leer «este negocio no cargó sus servicios»: es
 * información sobre nuestro formulario, no sobre el negocio. Le sirve saber que
 * puede preguntar, que es lo que iba a hacer igual. Al DUEÑO, en cambio, el
 * hueco es exactamente el aviso que necesita, y va con el botón que lo llena
 * — mismo criterio que ya usa la sección de horarios de esta página.
 *
 * ── POR QUÉ NO ES UNA LISTA CON VIÑETAS Y YA ────────────────────────────────
 * Son ítems cortos e independientes: en chips se leen de un vistazo y envuelven
 * solos a 375 px, mientras que una lista vertical de doce ítems empuja fuera de
 * pantalla las reseñas y los puestos abiertos, que es lo que viene después.
 */

export const SERVICIOS_TITULO = "Servicios";

const COPY = {
  vacioVisitante:
    "Todavía no publicó su lista de servicios. Podés escribirle y preguntarle directamente.",
  vacioDueño:
    "Contá qué hacés: es lo primero que busca quien entra a tu página. Van hasta 12, cortitos.",
  ctaDueño: "Agregar mis servicios",
  ctaEditar: "Editar mis servicios",
} as const;

export interface ServiciosSeccionProps {
  servicios: readonly string[];
  /** ¿Quien mira administra este negocio? Cambia el vacío y ofrece el botón. */
  administra: boolean;
  listingId: string;
  className?: string;
}

export function ServiciosSeccion({
  servicios,
  administra,
  listingId,
  className,
}: ServiciosSeccionProps) {
  const href = `/negocios/${listingId}/editar`;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {servicios.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {servicios.map((servicio) => (
            <li
              key={servicio}
              className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-sm text-foreground"
            >
              <CheckCircle
                size={15}
                weight="fill"
                aria-hidden="true"
                className="shrink-0 text-brand"
              />
              {servicio}
            </li>
          ))}
        </ul>
      ) : (
        <BezelCard coreClassName="flex items-start gap-3 p-4">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted">
            <Wrench size={20} />
          </span>
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {administra ? COPY.vacioDueño : COPY.vacioVisitante}
          </p>
        </BezelCard>
      )}

      {administra && (
        <Link
          href={href}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
        >
          <PencilSimple size={16} aria-hidden="true" />
          {servicios.length > 0 ? COPY.ctaEditar : COPY.ctaDueño}
        </Link>
      )}
    </div>
  );
}
