import type { Json } from "@/lib/types/database.types";
import type { TrustLevel, TrustSignal } from "@/components/trust";
import { buildTrustSignals, toTrustLevel } from "@/lib/trust/signals";

/**
 * =============================================================================
 * ADAPTADOR — la gramática de señales vive en @/lib/trust/signals
 * =============================================================================
 *
 * Este archivo TENÍA su propia implementación de `trust_scores.signals` → UI, y
 * la usaban /perfil y /perfil/[id]. El resultado: la misma persona mostraba una
 * hoja de Trust Score distinta según por dónde se la abriera —otras palabras
 * para las mismas señales, y una señal de más que sólo existía en el perfil—
 * mientras el docblock de la otra implementación se declaraba "fuente única".
 *
 * Ahora hay una sola gramática y esto sólo adapta la forma de los argumentos.
 * Se conserva el archivo porque las dos pantallas de perfil importan de acá; NO
 * volver a poner lógica adentro.
 */

/** `trust_scores.signals` + `profiles.identity_verified` → señales legibles. */
export function trustSignalsFrom(
  signals: Json | null | undefined,
  identityVerified: boolean,
): TrustSignal[] {
  return buildTrustSignals(signals ?? {}, identityVerified);
}

/** Normaliza el `level` de la DB; si viene raro, se deriva del score (canon). */
export function normalizeTrustLevel(
  level: string | null | undefined,
  score: number,
): TrustLevel {
  return toTrustLevel(level, score);
}
