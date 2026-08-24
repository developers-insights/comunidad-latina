/**
 * Trust Score → nivel. Gramática de confianza FIJA en todo el producto
 * (ARQUITECTURA.md §5): los umbrales son canon, nunca varían por tenant.
 */

export type TrustLevelId = "nuevo" | "activo" | "confiable" | "verificado" | "destacado";

export interface TrustLevel {
  id: TrustLevelId;
  /** Umbral inferior inclusive. */
  min: number;
  /** Umbral superior inclusive. */
  max: number;
  /** Label en español — la UI lo muestra siempre junto al número, nunca solo color. */
  label: string;
}

export const TRUST_LEVELS: readonly TrustLevel[] = [
  { id: "nuevo", min: 0, max: 29, label: "Nuevo" },
  { id: "activo", min: 30, max: 49, label: "Activo" },
  { id: "confiable", min: 50, max: 69, label: "Confiable" },
  // El `id` es el valor que guarda `trust_scores.level` y no se toca sin
  // migración; el LABEL sí, y no puede ser "Verificado" a secas (§11): este
  // peldaño se alcanza con antigüedad, transacciones y avales, sin haber
  // verificado ningún documento. La capa visual usa el mismo texto — ver
  // `components/trust/levels.ts`, que es la fuente de lo que se dibuja.
  { id: "verificado", min: 70, max: 84, label: "Reconocido" },
  { id: "destacado", min: 85, max: 100, label: "Destacado" },
] as const;

export function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function getTrustLevel(score: number): TrustLevel {
  const clamped = clampScore(score);
  return TRUST_LEVELS.find((level) => clamped >= level.min && clamped <= level.max) ?? TRUST_LEVELS[0];
}

// La capa VISUAL de niveles (Icon/textClass/segmentClass + segmentos llenos)
// vive en @/components/trust/levels — se deriva del nivel canónico de acá.
// Se eliminaron trustSegmentsFilled/formatTrustScore/trustScoreAriaLabel/
// TRUST_SEGMENTS por no tener consumidores (evita dos definiciones de
// "segmentos llenos" que puedan divergir).
