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

/** La barra de Trust Score siempre tiene 5 segmentos (uno por nivel). */
export const TRUST_SEGMENTS = 5;

export function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function getTrustLevel(score: number): TrustLevel {
  const clamped = clampScore(score);
  return TRUST_LEVELS.find((level) => clamped >= level.min && clamped <= level.max) ?? TRUST_LEVELS[0];
}

/** Segmentos llenos de la barra (1–5): el índice del nivel alcanzado. */
export function trustSegmentsFilled(score: number): number {
  return TRUST_LEVELS.indexOf(getTrustLevel(score)) + 1;
}

/** "87 · Confiable" — formato inline junto al nombre del autor. */
export function formatTrustScore(score: number): string {
  const clamped = clampScore(score);
  return `${clamped} · ${getTrustLevel(clamped).label}`;
}

/** aria-label del badge: "Trust Score 87, nivel Confiable". */
export function trustScoreAriaLabel(score: number): string {
  const clamped = clampScore(score);
  return `Trust Score ${clamped}, nivel ${getTrustLevel(clamped).label}`;
}
