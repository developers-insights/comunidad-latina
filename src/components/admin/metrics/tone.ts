import type { MetricKey } from "@/lib/metrics/types";

/**
 * Color de cada métrica. Un solo lugar: la tarjeta y el gráfico tienen que
 * pintar la misma serie del mismo color, o la leyenda deja de servir.
 *
 * Son tokens del design system, no hex sueltos, así que el modo oscuro los
 * resuelve solo. Se eligieron tres familias separadas en tono (azul / verde /
 * dorado) y no un degradé de la misma: un degradé obliga a distinguir por
 * intensidad, que es justo lo que falla con poca luz o con daltonismo. Igual
 * el color nunca es la única pista — la leyenda usa además tres formas.
 */
export const METRIC_TONE: Record<MetricKey, string> = {
  active: "var(--color-brand)",
  publishers: "var(--color-success)",
  contacters: "var(--color-gold)",
};
