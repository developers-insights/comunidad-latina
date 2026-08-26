import Link from "next/link";
import { CalendarBlank, CaretRight, MapPin } from "@phosphor-icons/react/dist/ssr";
import type { EventoDelNegocio } from "@/lib/negocios/eventos";
import { cn } from "@/lib/utils";

/**
 * "LO QUE ESTE NEGOCIO ORGANIZA" — los eventos, en la ficha.
 *
 * Es la mitad visible de la 0117, y la hermana exacta de `EmpleosDelNegocio`:
 * mismo alto de fila, mismo chip de ícono, misma flecha. Que se vean iguales no
 * es economía de código sino de lectura — las dos contestan la misma pregunta
 * («¿qué más hay acá adentro?») y darles dos formas distintas obligaría a
 * aprender la pantalla dos veces.
 *
 * ── POR QUÉ NO SE REUSA LA TARJETA DEL LISTADO DE EVENTOS ───────────────────
 * Mismo motivo que allá: la tarjeta grande trae foto 4:5, el "Quiero ir" y el
 * publicador — que acá es el negocio que ya estás mirando. Una fila alcanza:
 * qué es, cuándo y dónde. Anotarse sigue estando a un toque, en `/eventos/[id]`.
 *
 * Sin eventos no se renderiza NADA. Un "no hay eventos" no le sirve a nadie y le
 * agrega ruido a toda ficha de un comercio que simplemente no organiza nada.
 */

const COPY = {
  titulo: "Próximos eventos",
  verEvento: (titulo: string) => `Ver el evento: ${titulo}`,
  sinFecha: "Fecha a confirmar",
} as const;

export interface EventosDelNegocioProps {
  eventos: readonly EventoDelNegocio[];
  /**
   * Formateador de fecha ya resuelto con el reloj de QUIEN LEE (0067). Entra
   * por prop y no se construye acá porque leerlo es una consulta al perfil, y
   * la ficha ya la hizo para el resto de sus fechas.
   */
  formatearFecha: (iso: string) => string;
  className?: string;
}

export function EventosDelNegocio({
  eventos,
  formatearFecha,
  className,
}: EventosDelNegocioProps) {
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
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-secondary">
                <span>
                  {evento.empiezaEn ? formatearFecha(evento.empiezaEn) : COPY.sinFecha}
                </span>
                {evento.areaLabel && (
                  <span className="inline-flex min-w-0 items-center gap-1 text-xs">
                    <MapPin size={13} aria-hidden="true" className="shrink-0" />
                    <span className="truncate">{evento.areaLabel}</span>
                  </span>
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
