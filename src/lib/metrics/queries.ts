import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { metricsOverviewSchema, type MetricsOverview, type MetricsRange } from "./types";

/**
 * Lectura del tablero de métricas (RPC `admin_metrics_overview`, migración 0055).
 *
 * TODA la agregación pasa en Postgres. Acá no se cuenta nada: si esta capa
 * empezara a sumar, volverían a viajar filas de personas al server de Next
 * para tirarlas después, que es justo lo que la RPC existe para evitar.
 */

/**
 * `database.types.ts` está generado y se mantiene a mano (el MCP de Supabase no
 * tiene permiso sobre este proyecto), así que una RPC recién creada todavía no
 * figura ahí y `supabase.rpc("admin_metrics_overview")` no compila.
 *
 * En vez de tocar el archivo generado desde acá, se declara la firma exacta de
 * ESTA llamada y se hace UN cast, en un solo lugar y explicado. No es un `any`
 * suelto: el shape de entrada queda tipado y la salida se valida con zod abajo,
 * así que el contrato real se verifica en runtime, no se asume.
 *
 * Cuando se regenere `database.types.ts`, este bloque se borra y la llamada
 * pasa a ser directa.
 */
interface MetricsRpcClient {
  rpc(
    fn: "admin_metrics_overview",
    args: { p_tenant_id: string | null; p_days: number },
  ): PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
}

export type MetricsResult =
  | { ok: true; data: MetricsOverview }
  /** `forbidden` es distinto de `failed`: uno es "no te toca", el otro "se rompió". */
  | { ok: false; reason: "forbidden" | "failed" };

/** Códigos que la RPC levanta cuando el rol o el tenant no dan (ver 0055). */
const FORBIDDEN_CODE = "42501";

export async function fetchMetricsOverview(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string | null; days: MetricsRange },
): Promise<MetricsResult> {
  const client = supabase as unknown as MetricsRpcClient;

  const { data, error } = await client.rpc("admin_metrics_overview", {
    p_tenant_id: input.tenantId,
    p_days: input.days,
  });

  if (error) {
    // El mensaje de la base puede nombrar tenants o roles: se loguea el código,
    // nunca el texto crudo, y a la pantalla no llega ninguno de los dos.
    console.warn("[metricas] admin_metrics_overview falló", { code: error.code });
    return { ok: false, reason: error.code === FORBIDDEN_CODE ? "forbidden" : "failed" };
  }

  const parsed = metricsOverviewSchema.safeParse(data);
  if (!parsed.success) {
    console.warn("[metricas] el payload de la RPC no coincide con el schema");
    return { ok: false, reason: "failed" };
  }

  return { ok: true, data: parsed.data };
}

/**
 * ¿Hay algo que mostrar? Un cero en las tres métricas Y en cuentas nuevas es
 * una comunidad que todavía no arrancó, y merece un estado vacío que lo diga.
 *
 * Ojo con el matiz: es distinto de "falló la lectura". Un cero honesto es un
 * dato; por eso el estado vacío explica el cero en vez de disculparse.
 */
export function isEmptyOverview(data: MetricsOverview): boolean {
  const t = data.totals;
  return (
    t.active === 0 &&
    t.publishers === 0 &&
    t.contacters === 0 &&
    t.new_members === 0 &&
    t.publications === 0
  );
}

/**
 * Variación porcentual contra el período anterior.
 *
 * Devuelve null cuando el período anterior fue 0: "subió infinito" no es un
 * dato, es una división por cero disfrazada. En ese caso la tarjeta muestra el
 * texto de "sin comparación" en lugar de un porcentaje inventado.
 */
export function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
