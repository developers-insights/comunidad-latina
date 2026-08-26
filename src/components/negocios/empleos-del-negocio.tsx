import Link from "next/link";
import { Briefcase, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { Chip } from "@/components/ui";
import type { PuestoDelNegocio } from "@/lib/negocios/empleos";
import { cn } from "@/lib/utils";

/**
 * "ESTE NEGOCIO ESTÁ TOMANDO GENTE" — los puestos abiertos, en la ficha.
 *
 * Es la mitad visible de `listings.business_listing_id` (0107): hasta esa
 * migración, el aviso de empleo y la ficha del comercio eran dos avisos sin
 * nada que los uniera, y quien miraba el negocio no tenía cómo enterarse de que
 * buscaba empleados.
 *
 * ── POR QUÉ NO SE REUSA `JobCard` ───────────────────────────────────────────
 * `JobCard` es la tarjeta del LISTADO de Empleos: foto 4:5, franja de vidrio,
 * botón de postulación inline y trust del publicador. Metida dentro de una ficha
 * de negocio compite con la ficha y repite el publicador (que es el negocio que
 * ya estás mirando). Acá alcanza una fila: el puesto, cuánto paga y de qué
 * modalidad es. Postularse sigue estando a un toque, en `/empleos/[id]`, con la
 * tarjeta completa y su formulario.
 *
 * Sin puestos, no se renderiza NADA: un "este negocio no tiene vacantes" no le
 * sirve a nadie y le agrega ruido a toda ficha que no esté contratando.
 */

const COPY = {
  titulo: "Puestos abiertos",
  verPuesto: (titulo: string) => `Ver el puesto: ${titulo}`,
  salarioAConvenir: "Pago a convenir",
} as const;

export interface EmpleosDelNegocioProps {
  puestos: readonly PuestoDelNegocio[];
  className?: string;
}

export function EmpleosDelNegocio({ puestos, className }: EmpleosDelNegocioProps) {
  if (puestos.length === 0) return null;

  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {puestos.map((puesto) => (
        <li key={puesto.id}>
          <Link
            href={`/empleos/${puesto.id}`}
            aria-label={COPY.verPuesto(puesto.titulo)}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3",
              "transition-colors duration-(--duration-fast) hover:bg-surface-subtle",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-foreground-muted"
            >
              <Briefcase size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">
                {puesto.titulo}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                {/* `numeric` (tabular): el monto es lo que frena el scroll en un
                    aviso de trabajo, y con anchos parejos se compara de un vistazo. */}
                <span className="numeric text-sm text-foreground-secondary">
                  {puesto.salarioEtiqueta ?? COPY.salarioAConvenir}
                </span>
                {puesto.modalidad && (
                  <Chip variant="neutral" size="sm">
                    {puesto.modalidad}
                  </Chip>
                )}
              </span>
            </span>
            <CaretRight
              size={16}
              aria-hidden="true"
              className="shrink-0 text-foreground-muted"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Título de la sección, para que la ficha no tenga que escribirlo dos veces. */
export const EMPLEOS_DEL_NEGOCIO_TITULO = COPY.titulo;
