import { Star } from "@phosphor-icons/react/dist/ssr";
import { BezelCard } from "@/components/ui";
import { RESENAS_COPY as C, formatearPromedio, type ResumenPuntaje } from "@/lib/resenas";
import { cn } from "@/lib/utils";
import { Estrellas } from "./estrellas";

export interface ResumenPuntajeProps {
  resumen: ResumenPuntaje;
  /** Distribución 5→1. Se omite cuando hay muy pocas reseñas para que signifique algo. */
  reparto?: { puntaje: number; cantidad: number; porcentaje: number }[];
  className?: string;
}

/** A partir de acá una distribución dice algo; abajo es ruido con forma de dato. */
const MINIMO_PARA_REPARTO = 3;

/**
 * Resumen de puntaje de un aviso.
 *
 * SIN RESEÑAS NO SE MUESTRA UN CERO. Cinco estrellas vacías y un "0,0" leen como
 * "este negocio es malo" cuando lo que pasa es que nadie opinó todavía. La
 * ausencia se dice con palabras — el mismo criterio que `RatingStars` de
 * Colaboraciones, que muestra "Nuevo".
 */
export function ResumenPuntajeCard({ resumen, reparto, className }: ResumenPuntajeProps) {
  const promedio = formatearPromedio(resumen.promedio);

  if (!promedio || resumen.cantidad === 0) {
    return (
      <BezelCard coreClassName={cn("flex items-center gap-3 p-4", className)}>
        <span aria-hidden="true" className="shrink-0 text-foreground-muted">
          <Star size={20} />
        </span>
        <p className="text-sm text-foreground-secondary">{C.sinPuntaje}</p>
      </BezelCard>
    );
  }

  const mostrarReparto = Boolean(reparto) && resumen.cantidad >= MINIMO_PARA_REPARTO;

  return (
    <BezelCard coreClassName={cn("p-4", className)}>
      <div className="flex items-center gap-4">
        <p className="numeric font-display text-4xl font-bold leading-none text-foreground">
          {promedio}
        </p>
        <div className="min-w-0">
          <Estrellas
            valor={resumen.promedio}
            size={18}
            etiqueta={C.promedioAria(promedio, resumen.cantidad)}
          />
          <p className="numeric mt-1 text-sm text-foreground-secondary">
            {C.cantidad(resumen.cantidad)}
          </p>
        </div>
      </div>

      {mostrarReparto && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {reparto?.map((fila) => (
            <li key={fila.puntaje} className="flex items-center gap-2">
              <span className="numeric w-8 shrink-0 text-right text-xs text-foreground-secondary">
                {fila.puntaje}★
              </span>
              {/* La barra es decoración: el dato lo dice el número de al lado y
                  el aria-label de la fila. Sin depender del color ni del ancho. */}
              <span
                aria-hidden="true"
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-subtle"
              >
                <span
                  className="block h-full rounded-full bg-warning"
                  style={{ width: `${fila.porcentaje}%` }}
                />
              </span>
              <span
                className="numeric w-6 shrink-0 text-xs text-foreground-muted"
                aria-label={C.distribucionFila(fila.puntaje, fila.cantidad)}
              >
                {fila.cantidad}
              </span>
            </li>
          ))}
        </ul>
      )}
    </BezelCard>
  );
}
