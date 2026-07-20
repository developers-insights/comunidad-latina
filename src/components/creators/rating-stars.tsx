import { Star } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { formatRating } from "./helpers";
import { COPY } from "./copy";

export interface RatingStarsProps {
  avg: number | null | undefined;
  count: number;
  size?: number;
  /** Oculta el "(N)" de reseñas — útil en espacios muy chicos. */
  hideCount?: boolean;
  className?: string;
}

/**
 * Estrellas de reputación del creador (parte del "score de crédito"). Si todavía
 * no tiene reseñas muestra "Nuevo" en positivo — nunca cero estrellas en rojo
 * (§ ausencia, jamás castigo). Componente de solo lectura.
 */
export function RatingStars({ avg, count, size = 14, hideCount = false, className }: RatingStarsProps) {
  const rating = formatRating(avg);

  if (!rating) {
    return (
      <span className={cn("text-xs font-semibold text-foreground-muted", className)}>
        {COPY.directory.noRating}
      </span>
    );
  }

  const rounded = Math.round(Number(rating));

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      aria-label={`${rating} de 5 · ${COPY.directory.ratingCount(count)}`}
    >
      <span aria-hidden="true" className="inline-flex items-center">
        {Array.from({ length: 5 }, (_, index) => (
          <Star
            key={index}
            size={size}
            weight={index < rounded ? "fill" : "regular"}
            className={index < rounded ? "text-warning" : "text-border"}
          />
        ))}
      </span>
      <span className="numeric text-sm font-semibold text-foreground">{rating}</span>
      {!hideCount && <span className="text-xs text-foreground-muted">({count})</span>}
    </span>
  );
}
