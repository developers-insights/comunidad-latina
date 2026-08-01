import { z } from "zod";

/**
 * Forma del payload de `public.admin_metrics_overview` (migración 0055).
 *
 * Por qué hay un schema de zod para algo que sale de nuestra propia base: la
 * RPC devuelve `jsonb`, o sea `unknown` del lado de TypeScript. Sin validar,
 * un cambio en el SQL se descubriría en producción como "undefined" pintado en
 * una tarjeta. Con el schema, se descubre como un error de lectura y la
 * pantalla muestra su estado de error, que es lo honesto.
 */

export const METRICS_RANGES = [7, 30, 90] as const;
export type MetricsRange = (typeof METRICS_RANGES)[number];

export function isMetricsRange(value: number): value is MetricsRange {
  return (METRICS_RANGES as readonly number[]).includes(value);
}

const countSchema = z.number().int().nonnegative();

export const metricsPointSchema = z.object({
  /** Día en formato YYYY-MM-DD (UTC). */
  day: z.string(),
  active: countSchema,
  publishers: countSchema,
  contacters: countSchema,
});

export const metricsOverviewSchema = z.object({
  tenant_id: z.string().nullable(),
  days: z.number().int().positive(),
  from: z.string(),
  to: z.string(),
  generated_at: z.string(),
  totals: z.object({
    active: countSchema,
    publishers: countSchema,
    contacters: countSchema,
    publications: countSchema,
    contacts: countSchema,
    accepted_contacts: countSchema,
    new_members: countSchema,
  }),
  previous: z.object({
    active: countSchema,
    publishers: countSchema,
    contacters: countSchema,
    new_members: countSchema,
  }),
  series: z.array(metricsPointSchema),
});

export type MetricsPoint = z.infer<typeof metricsPointSchema>;
export type MetricsOverview = z.infer<typeof metricsOverviewSchema>;

/** Las tres métricas del plan, en el orden en que se leen en pantalla. */
export const METRIC_KEYS = ["active", "publishers", "contacters"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
