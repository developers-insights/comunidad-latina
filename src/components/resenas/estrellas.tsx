import { Star } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { PUNTAJE_MAX, estrellasLlenas } from "@/lib/resenas";

export interface EstrellasProps {
  /** Promedio o puntaje. `null` = todavía no hay nada que mostrar. */
  valor: number | null;
  size?: number;
  /**
   * Lo que anuncia el lector de pantalla. Las estrellas en sí van con
   * `aria-hidden`: cinco íconos leídos uno por uno son ruido, no información.
   */
  etiqueta: string;
  className?: string;
}

/**
 * Estrellas de SOLO LECTURA.
 *
 * Dos decisiones de accesibilidad que no son estéticas:
 *
 *  1. El grupo es UN solo nodo con `role="img"` y su etiqueta: quien usa lector
 *     de pantalla escucha "4,3 de 5 estrellas, sobre 12 reseñas" y sigue, en vez
 *     de escuchar "estrella, estrella, estrella…".
 *  2. La estrella vacía no se distingue de la llena SOLO por color: cambia de
 *     peso (`fill` contra `regular`), así que la diferencia se ve también sin
 *     percepción de color y en alto contraste.
 */
export function Estrellas({ valor, size = 16, etiqueta, className }: EstrellasProps) {
  const llenas = estrellasLlenas(valor);

  return (
    <span
      role="img"
      aria-label={etiqueta}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {Array.from({ length: PUNTAJE_MAX }, (_, index) => (
        <Star
          key={index}
          size={size}
          weight={index < llenas ? "fill" : "regular"}
          aria-hidden="true"
          className={index < llenas ? "text-warning" : "text-border"}
        />
      ))}
    </span>
  );
}
