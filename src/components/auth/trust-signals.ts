import type { Json } from "@/lib/types/database.types";
import { getTrustLevel } from "@/lib/trust/levels";
import type { TrustLevel } from "@/components/trust";
import type { TrustSignal } from "@/components/trust";

/**
 * Traduce el jsonb `trust_scores.signals` (forma sembrada:
 * { months_in_community, transactions_ok, endorsements_count, reports_upheld })
 * + `profiles.identity_verified` a señales legibles para el TrustScoreSheet.
 * Señales pendientes en positivo ("todavía no"), nunca en castigo (§4.c).
 */

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function monthsLabel(months: number): string {
  if (months >= 24) return `${Math.floor(months / 12)} años en la comunidad`;
  if (months >= 12) return "Más de 1 año en la comunidad";
  return `${months} ${months === 1 ? "mes" : "meses"} en la comunidad`;
}

export function trustSignalsFrom(
  signals: Json | null | undefined,
  identityVerified: boolean,
): TrustSignal[] {
  const raw =
    signals && typeof signals === "object" && !Array.isArray(signals)
      ? (signals as Record<string, unknown>)
      : {};

  const months = asNumber(raw.months_in_community);
  const transactions = asNumber(raw.transactions_ok);
  const endorsements = asNumber(raw.endorsements_count);
  const reportsUpheld = asNumber(raw.reports_upheld);

  const list: TrustSignal[] = [
    identityVerified
      ? { label: "Identidad verificada con documento", achieved: true }
      : { label: "Verificar su identidad con documento", achieved: false },
    months > 0
      ? { label: monthsLabel(months), achieved: true }
      : { label: "Cumplir sus primeros meses en la comunidad", achieved: false },
    transactions > 0
      ? {
          label: `${transactions} ${transactions === 1 ? "transacción" : "transacciones"} sin disputa`,
          achieved: true,
        }
      : { label: "Completar su primera transacción sin disputa", achieved: false },
    endorsements > 0
      ? {
          label: `Con el aval de ${endorsements} ${endorsements === 1 ? "vecino verificado" : "vecinos verificados"}`,
          achieved: true,
        }
      : { label: "Recibir el aval de un vecino verificado", achieved: false },
  ];

  if (reportsUpheld > 0) {
    list.push({
      label: `${reportsUpheld} ${reportsUpheld === 1 ? "reporte confirmado" : "reportes confirmados"} de la comunidad`,
      achieved: false,
    });
  } else {
    list.push({ label: "Sin reportes confirmados", achieved: true });
  }

  return list;
}

/** Señales concretas en texto plano para el perfil (§4.c) — solo las logradas. */
export function concreteSignals(signals: TrustSignal[]): string[] {
  return signals
    .filter((s) => s.achieved)
    .map((s) => s.label)
    .slice(0, 3);
}

const VALID_LEVELS: readonly TrustLevel[] = [
  "nuevo",
  "verificado",
  "confiable",
  "premium",
  "diamante",
];

/** Normaliza el `level` de la DB; si viene raro, se deriva del score (canon). */
export function normalizeTrustLevel(
  level: string | null | undefined,
  score: number,
): TrustLevel {
  if (level && (VALID_LEVELS as readonly string[]).includes(level)) {
    return level as TrustLevel;
  }
  return getTrustLevel(score).id;
}
