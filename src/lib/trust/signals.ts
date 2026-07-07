import type { Json, Tables } from "@/lib/types/database.types";
import type { TrustLevel, TrustSignal } from "@/components/trust";

/**
 * FUENTE ÚNICA de la gramática de señales de confianza (ARQUITECTURA.md §5,
 * PLAN_MAESTRO §3): el mapeo `trust_scores` → props de la UI vive acá y solo
 * acá. El moat del producto ES la confianza, así que un mismo usuario DEBE
 * mostrar exactamente las mismas señales en toda superficie (vivienda,
 * negocios, mensajes, profesionales, eventos).
 *
 * Módulo puro y sin dependencias de servidor: usable desde Server Components y
 * client components por igual. Los tipos `TrustLevel`/`TrustSignal` se importan
 * type-only del barrel de components/trust (no arrastra runtime del cliente).
 *
 * Las señales pendientes van SIEMPRE en positivo ("todavía no"), nunca en
 * castigo (§4.c: ausencia, jamás un negativo).
 */

const TRUST_LEVEL_IDS = new Set<string>([
  "nuevo",
  "verificado",
  "confiable",
  "premium",
  "diamante",
]);

/** Normaliza el `level` crudo de la DB; si viene raro degrada a "nuevo". */
export function toTrustLevel(level: string | null | undefined): TrustLevel {
  return level && TRUST_LEVEL_IDS.has(level) ? (level as TrustLevel) : "nuevo";
}

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * `trust_scores.signals` (jsonb, forma del seed: months_in_community,
 * transactions_ok, endorsements_count) → lista legible para el TrustScoreSheet.
 * Nunca inventa señales: solo traduce las que existen; las faltantes van en
 * gris como "todavía no".
 */
export function buildTrustSignals(
  signals: Json,
  identityVerified: boolean,
): TrustSignal[] {
  const record =
    signals !== null && typeof signals === "object" && !Array.isArray(signals)
      ? (signals as Record<string, unknown>)
      : {};

  const months = asFiniteNumber(record.months_in_community) ?? 0;
  const transactions = asFiniteNumber(record.transactions_ok) ?? 0;
  const endorsements = asFiniteNumber(record.endorsements_count) ?? 0;

  const monthsLabel =
    months >= 12
      ? `En la comunidad hace ${Math.floor(months / 12)} ${Math.floor(months / 12) === 1 ? "año" : "años"}`
      : months >= 1
        ? `En la comunidad hace ${months} ${months === 1 ? "mes" : "meses"}`
        : "Tiempo en la comunidad";

  return [
    {
      label: identityVerified ? "Identidad verificada (documento)" : "Verificar su identidad",
      achieved: identityVerified,
    },
    { label: monthsLabel, achieved: months >= 1 },
    {
      label:
        transactions > 0
          ? `${transactions} ${transactions === 1 ? "transacción" : "transacciones"} sin disputa`
          : "Transacciones sin disputa",
      achieved: transactions > 0,
    },
    {
      label:
        endorsements > 0
          ? `${endorsements} ${endorsements === 1 ? "vecino verificado la avala" : "vecinos verificados la avalan"}`
          : "Avales de vecinos verificados",
      achieved: endorsements > 0,
    },
  ];
}

/**
 * Fila de `trust_scores` → props canónicas de la UI de confianza.
 * Defensivo: si la fila es null devuelve null; el nivel se normaliza y el
 * score se clampea a 0–100 entero.
 */
export function toTrustProps(
  row: Pick<Tables<"trust_scores">, "score" | "level" | "signals"> | null | undefined,
  identityVerified: boolean,
): { score: number; level: TrustLevel; signals: TrustSignal[] } | null {
  if (!row) return null;
  return {
    score: Math.max(0, Math.min(100, Math.round(row.score))),
    level: toTrustLevel(row.level),
    signals: buildTrustSignals(row.signals, identityVerified),
  };
}
