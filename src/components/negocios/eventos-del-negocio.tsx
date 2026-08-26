import Link from "next/link";
import { CalendarBlank, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { Chip } from "@/components/ui";
import type { EventoDelNegocio } from "@/lib/negocios/eventos";
import { cn } from "@/lib/utils";

/**
 * "ESTE NEGOCIO TIENE EVENTOS PRÓXIMOS" — en la ficha, junto a los puestos
 * abiertos. Espejo visual de `EmpleosDelNegocio` (mismo layout de fila, mismos
 * tamaños, misma regla de accesibilidad) — la diferencia real entre las dos
 * está en cómo se arma la lista, no en cómo se ve; ver el docblock de
 * `lib/negocios/eventos.ts` para el porqué (no hay FK como la de los empleos).
 *
 * Sin eventos vigentes, no se renderiza NADA — mismo criterio que
 * `EmpleosDelNegocio`: un "este negocio no tiene eventos" no le sirve a nadie y
 * le agrega ruido a toda ficha que no tenga uno agendado.
 */

const COPY = {
  titulo: "Próximos eventos",
  verEvento: (titulo: string) => `Ver el evento: ${titulo}`,
  gratis: "Gratis",
} as const;

export interface EventosDelNegocioProps {
  eventos: readonly EventoDelNegocio[];
  className?: string;
}

export function EventosDelNegocio({ eventos, className }: EventosDelNegocioProps) {
  if (eventos.length === 0) return null;

  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {eventos.map((evento) => (
        <li key={evento.id}>
          <Link
            href={`/eventos/${evento.id}`}
            aria-label={COPY.verEvento(evento.titulo)}
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
              <CalendarBlank size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">
                {evento.titulo}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                {/* `numeric` (tabular) por consistencia con la fila de empleos,
                    aunque acá no haya un monto: son las mismas cifras de fecha
                    (día + hora) que sí se benefician de anchos parejos. */}
                <span className="numeric text-sm text-foreground-secondary">
                  {evento.fechaCorta}
                  {evento.horaLabel ? ` · ${evento.horaLabel}` : ""}
                </span>
                {evento.gratis && (
                  <Chip variant="neutral" size="sm">
                    {COPY.gratis}
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
export const EVENTOS_DEL_NEGOCIO_TITULO = COPY.titulo;
