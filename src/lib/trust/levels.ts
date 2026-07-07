/**
 * Trust Score → nivel. Gramática de confianza FIJA en todo el producto
 * (ARQUITECTURA.md §5): los umbrales son canon, nunca varían por tenant.
 */

export type TrustLevelId = "nuevo" | "verificado" | "confiable" | "premium" | "diamante";

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
  { id: "nuevo", min: 0, max: 19, label: "Nuevo" },
  { id: "verificado", min: 20, max: 39, label: "Verificado" },
  { id: "confiable", min: 40, max: 69, label: "Confiable" },
  { id: "premium", min: 70, max: 89, label: "Premium" },
  { id: "diamante", min: 90, max: 100, label: "Diamante" },
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
