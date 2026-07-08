import { cn } from "@/lib/utils";
import { Emblem, EMBLEM_MIN_SIZE } from "@/components/ui/emblem";
import { TRUST_LEVELS, type TrustLevel } from "./levels";

export interface TrustLevelMarkProps {
  level: TrustLevel;
  /** Lado en px. Decide el medio: ≥28 emblema 3D, <28 ícono de línea. */
  size: number;
  priority?: boolean;
  className?: string;
}

/**
 * La marca de un nivel de Trust Score, en el medio correcto para su tamaño.
 *
 * Un render 3D a 14px es puré: a escala de texto la iconografía funcional sigue
 * siendo Phosphor línea (§2.6, trazo consistente). El emblema 3D entra recién
 * cuando hay superficie para que se lea como objeto —la card del perfil, la
 * hoja del desglose—, que es justo donde el nivel tiene peso emocional
 * ("level-up", coleccionable).
 *
 * El ícono de línea NO es un fallback degradado: es la representación correcta
 * en su tamaño. Por eso los dos conviven en la misma gramática (§3.3).
 */
export function TrustLevelMark({
  level,
  size,
  priority,
  className,
}: TrustLevelMarkProps) {
  const config = TRUST_LEVELS[level];

  if (size < EMBLEM_MIN_SIZE) {
    return (
      <config.Icon
        size={size}
        aria-hidden="true"
        className={cn("shrink-0", config.textClass, className)}
      />
    );
  }

  return (
    <Emblem
      name={config.emblem}
      size={size}
      priority={priority}
      className={cn("shrink-0", className)}
    />
  );
}
