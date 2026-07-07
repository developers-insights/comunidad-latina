import type { TrustLevel, TrustSignal } from "@/components/trust";
import type { Json, Tables } from "@/lib/types/database.types";

/**
 * Mapea la fila real de trust_scores a las props de la UI de confianza.
 * Defensivo: si el nivel viene raro o los signals no tienen la forma esperada,
 * degrada a "nuevo" con señales derivadas — nunca rompe el hilo.
 */

const VALID_LEVELS: readonly TrustLevel[] = [
  "nuevo",
  "verificado",
  "confiable",
  "premium",
  "diamante",
];

export function toTrustLevel(level: string | null | undefined): TrustLevel {
  return VALID_LEVELS.includes(level as TrustLevel) ? (level as TrustLevel) : "nuevo";
}

function signalNumber(signals: Json, key: string): number {
  if (signals === null || typeof signals !== "object" || Array.isArray(signals)) return 0;
  const value = (signals as Record<string, Json | undefined>)[key];
  return typeof value === "number" ? value : 0;
}

/**
 * Señales legibles para el TrustScoreSheet a partir del jsonb `signals`
 * (forma del seed: months_in_community, transactions_ok, endorsements_count).
 * Las pendientes van en positivo ("todavía no") — nunca en negativo (§3.3).
 */
export function toTrustSignals(
  signals: Json,
  identityVerified: boolean,
): TrustSignal[] {
  const months = signalNumber(signals, "months_in_community");
  const transactions = signalNumber(signals, "transactions_ok");
  const endorsements = signalNumber(signals, "endorsements_count");

  return [
    {
      label: "Identidad verificada (documento)",
      achieved: identityVerified,
    },
    {
      label:
        months > 0
          ? `${months} ${months === 1 ? "mes" : "meses"} en la comunidad`
          : "Tiempo en la comunidad",
      achieved: months > 0,
    },
    {
      label:
        transactions > 0
          ? `${transactions} ${transactions === 1 ? "operación completada" : "operaciones completadas"} sin problemas`
          : "Operaciones completadas sin problemas",
      achieved: transactions > 0,
    },
    {
      label:
        endorsements > 0
          ? `${endorsements} ${endorsements === 1 ? "recomendación" : "recomendaciones"} de la comunidad`
          : "Recomendaciones de la comunidad",
      achieved: endorsements > 0,
    },
  ];
}

export function toTrustProps(
  row: Pick<Tables<"trust_scores">, "score" | "level" | "signals"> | null,
  identityVerified: boolean,
): { score: number; level: TrustLevel; signals: TrustSignal[] } | null {
  if (!row) return null;
  return {
    score: Math.max(0, Math.min(100, Math.round(row.score))),
    level: toTrustLevel(row.level),
    signals: toTrustSignals(row.signals, identityVerified),
  };
}
