import type { Json, Tables } from "@/lib/types/database.types";
import { getTrustLevel } from "@/lib/trust/levels";
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
 *
 * -----------------------------------------------------------------------------
 * ESTE DOCBLOCK DECÍA "FUENTE ÚNICA" Y NO LO ERA (arreglado acá)
 *
 * Existía una segunda implementación —`trustSignalsFrom`, en
 * components/auth/trust-signals.ts— que usaban /perfil y /perfil/[id]. La misma
 * persona mostraba una hoja de Trust Score distinta según por dónde se la
 * abriera: "Identidad verificada (documento)" en el feed contra "Identidad
 * verificada con documento" en su perfil, "En la comunidad hace 3 meses" contra
 * "3 meses en la comunidad", y una quinta señal (los reportes) que sólo existía
 * en el perfil. Un número que se explica de dos maneras distintas es un número
 * en el que no se puede confiar, que es exactamente lo contrario de para lo que
 * está. Ahora `trustSignalsFrom` reexporta esto y la señal de reportes —que era
 * la buena idea de la otra versión— vive acá, para todas las superficies.
 * -----------------------------------------------------------------------------
 */

const TRUST_LEVEL_IDS = new Set<string>([
  "nuevo",
  "activo",
  "confiable",
  "verificado",
  "destacado",
]);

/**
 * Normaliza el `level` crudo de la DB.
 *
 * Con `scoreFallback`, un valor corrupto se deriva del score (el canon de
 * `lib/trust/levels.ts`); sin él, degrada a "nuevo". Los dos caminos existían
 * sueltos en dos archivos distintos y no coincidían: una fila con el `level`
 * roto y 90 puntos se leía "Nuevo" en el feed y "Destacado" en el perfil.
 */
export function toTrustLevel(
  level: string | null | undefined,
  scoreFallback?: number,
): TrustLevel {
  if (level && TRUST_LEVEL_IDS.has(level)) return level as TrustLevel;
  return scoreFallback === undefined ? "nuevo" : getTrustLevel(scoreFallback).id;
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
  const reportsUpheld = asFiniteNumber(record.reports_upheld) ?? 0;

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
      // "de la comunidad" y NO "verificados": `endorsements_count` es un
      // contador crudo (0003 §5.4 — a propósito no hay grafo de quién avaló a
      // quién), así que no sabemos si esas personas verificaron su identidad.
      // Afirmarlo era usar la palabra más cargada de la app sobre un dato que
      // no la respalda.
      label:
        endorsements > 0
          ? `${endorsements} ${endorsements === 1 ? "vecino de la comunidad la avala" : "vecinos de la comunidad la avalan"}`
          : "Avales de vecinos de la comunidad",
      achieved: endorsements > 0,
    },
    // La quinta señal, que antes sólo veía quien abría un perfil. Va en los dos
    // sentidos: sin reportes es un logro que se muestra, y con reportes es el
    // dato que más le importa a quien está por mandar plata.
    reportsUpheld > 0
      ? {
          label: `${reportsUpheld} ${reportsUpheld === 1 ? "reporte confirmado" : "reportes confirmados"} de la comunidad`,
          achieved: false,
        }
      : { label: "Sin reportes confirmados", achieved: true },
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
