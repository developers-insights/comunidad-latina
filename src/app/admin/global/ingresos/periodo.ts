/**
 * El período del tablero de ingresos, resuelto sin I/O y por eso testeable.
 *
 * Se eligen VENTANAS FIJAS (7 / 30 / 90 / 365 días) y no un par de fechas
 * libres. No es pereza: un rango libre invita a comparar dos ventanas de largo
 * distinto y sacar una conclusión falsa ("bajó" cuando lo que cambió fue el
 * tamaño de la ventana). Con las mismas cuatro opciones que ya usa Métricas, la
 * comparación entre pantallas es directa.
 *
 * `from` es inclusivo y `to` exclusivo, igual que el `>= p_from and < p_to` de
 * la función de la base (0074): así un evento no puede contarse en dos períodos
 * contiguos ni caerse entre los dos.
 */

export const PERIOD_DAYS = [7, 30, 90, 365] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];

export const DEFAULT_PERIOD: PeriodDays = 30;

export const PERIOD_LABEL: Record<PeriodDays, string> = {
  7: "7 días",
  30: "30 días",
  90: "90 días",
  365: "12 meses",
};

export function isPeriodDays(raw: unknown): raw is PeriodDays {
  return PERIOD_DAYS.includes(Number(raw) as PeriodDays);
}

/** Un valor de URL desconocido cae al default en silencio; nunca se usa crudo. */
export function parsePeriod(raw: string | null): PeriodDays {
  return isPeriodDays(raw) ? (Number(raw) as PeriodDays) : DEFAULT_PERIOD;
}

export function periodRange(days: PeriodDays, now: Date = new Date()): { from: string; to: string } {
  const to = new Date(now.getTime());
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}
