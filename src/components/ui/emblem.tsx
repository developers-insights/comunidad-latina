import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * EMBLEMA 3D — raster premium para los momentos de CONFIANZA y EMOCIÓN.
 *
 * NO es iconografía funcional. La UI sigue usando Phosphor línea (§2.6): estos
 * emblemas aparecen solo donde el producto necesita peso emocional (el hero del
 * Escudo Anti-Estafa, el resultado de una verificación, el nivel de Trust Score).
 *
 * Origen: modelos 3D generados con Meshy (image-to-3d, malla + textura mate) y
 * renderizados a PNG con alfa; luego optimizados a WebP 256² con sharp. NADA de
 * 3D en vivo: el público objetivo está en conexiones malas y gama baja (§3.4),
 * así que se paga el costo de un raster de ~10 KB, no el de un canvas WebGL.
 *
 * Colores: SOLO de la capa fija del design system (neutros + semánticos). Un
 * raster no puede llevar el color de marca del tenant —varía por dominio— así
 * que ningún emblema lo usa. La gramática visual es fija por guardrail (§6).
 */
export const EMBLEM_SOURCES = {
  /** Escudo verde: protección. Hero de /escudo + nivel "Confiable". */
  "escudo-check": "/brand/emblems/escudo-check.webp",
  /** Escudo ámbar: advertencia anti-estafa. */
  "escudo-alerta": "/brand/emblems/escudo-alerta.webp",
  /** Sello verde: matrícula hallada en el registro oficial. */
  "sello-check": "/brand/emblems/sello-check.webp",
  /** Sello rojo: no figura en el registro oficial. */
  "sello-x": "/brand/emblems/sello-x.webp",
  /** Brote: nivel "Nuevo". */
  "nivel-nuevo": "/brand/emblems/nivel-nuevo.webp",
  /** Sello azul: nivel "Verificado". */
  "nivel-verificado": "/brand/emblems/nivel-verificado.webp",
  /** Estrella dorada: nivel "Premium". */
  "nivel-premium": "/brand/emblems/nivel-premium.webp",
  /** Cristal: nivel "Diamante". */
  "nivel-diamante": "/brand/emblems/nivel-diamante.webp",
} as const;

export type EmblemName = keyof typeof EMBLEM_SOURCES;

/**
 * Por debajo de este lado en px un render 3D se vuelve puré: se usa el ícono
 * Phosphor de línea. Ver `TrustLevelMark`.
 */
export const EMBLEM_MIN_SIZE = 28;

export interface EmblemProps {
  name: EmblemName;
  /** Lado del cuadrado en px. El source es 256², así que ≤128 queda nítido en @2x. */
  size: number;
  /**
   * Solo para el emblema que está sobre el pliegue en su pantalla (hoy: el hero
   * de /escudo). El resto va lazy — nunca compiten con el LCP.
   */
  priority?: boolean;
  className?: string;
}

/**
 * Decorativo por contrato: `alt=""` + `aria-hidden`. En todas las superficies
 * donde se usa hay texto adyacente que ya nombra el significado ("Escudo
 * Anti-Estafa", "Nivel: Confiable", "No encontrado"). Ponerle un alt descriptivo
 * haría que el lector de pantalla lea el concepto dos veces.
 */
export function Emblem({ name, size, priority = false, className }: EmblemProps) {
  return (
    <Image
      src={EMBLEM_SOURCES[name]}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      // Sin `sizes` a propósito: con ancho fijo Next emite un srcset 1x/2x
      // (descriptores `x`). Pasar `sizes` lo cambiaría a descriptores `w` y el
      // browser bajaría una variante del tamaño del viewport, no del emblema.
      priority={priority}
      draggable={false}
      className={cn("select-none", className)}
    />
  );
}
