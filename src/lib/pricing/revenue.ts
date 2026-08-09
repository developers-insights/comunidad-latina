import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * =============================================================================
 * INGRESOS — la única puerta de entrada a `payment_events`
 * =============================================================================
 *
 * `payment_events` tiene sus cuatro policies en `false`: nadie con un JWT de
 * usuario la lee, ni el súper admin. Es deliberado — el payload crudo de Stripe
 * trae mail del comprador, datos de facturación y resultados de verificación de
 * identidad. Lo único que sale de la base son los agregados que devuelven
 * `admin_revenue_summary` y `admin_revenue_events` (migración 0074), que además
 * vuelven a chequear el rol adentro.
 *
 * POR QUÉ HAY DOS `as` EN ESTE ARCHIVO Y NO EN LA PANTALLA
 *   El generador de tipos de Supabase no modela la nulabilidad de los
 *   argumentos ni de las columnas devueltas por una función: escribe todo como
 *   no-nulo. Pero `p_tenant = null` significa "todas las comunidades" y es la
 *   forma en que el súper admin mira la plataforma entera; y `net_cents` /
 *   `currency` vuelven NULL a propósito cuando el monto no se pudo leer, que es
 *   justamente el hueco que la pantalla tiene que mostrar en vez de un cero.
 *   Las conversiones viven acá, comentadas, en vez de repartidas por el JSX:
 *   un `as` explicado en un módulo de datos es mantenible; cinco escondidos en
 *   una vista, no.
 *
 * NUNCA LANZA. Devuelve `{ rows: null }` cuando la consulta falló, para que la
 * pantalla distinga "no se pudo calcular" (hueco) de "no hubo ingresos" (cero
 * legítimo). Es la regla que gobierna todo el tablero.
 */

/** Una fila del resumen. `net_cents` y `currency` son NULL si no se pudo leer. */
export interface RevenueSummaryRow {
  tenant_id: string | null;
  product: string;
  currency: string | null;
  net_cents: number | null;
  payments: number;
  refunds: number;
  unreadable: number;
}

/** Un evento de dinero, sin nada de la persona que pagó. */
export interface RevenueEventRow {
  id: string;
  tenant_id: string | null;
  event_type: string;
  product: string;
  amount_cents: number | null;
  currency: string | null;
  processed: boolean;
  failed: boolean;
  received_at: string;
}

export interface RevenueQuery {
  /** `null` = todas las comunidades. Sólo el súper admin puede pedir eso. */
  tenantId: string | null;
  from: string;
  to: string;
}

type Db = SupabaseClient<Database>;

export async function getRevenueSummary(
  supabase: Db,
  query: RevenueQuery,
): Promise<{ rows: RevenueSummaryRow[] | null }> {
  const { data, error } = await supabase.rpc("admin_revenue_summary", {
    p_tenant: query.tenantId,
    p_from: query.from,
    p_to: query.to,
  } as never);

  if (error) {
    console.error("[ingresos] admin_revenue_summary falló:", error.message);
    return { rows: null };
  }
  return { rows: (data ?? []) as unknown as RevenueSummaryRow[] };
}

export interface RevenueEventsQuery extends RevenueQuery {
  cursor: { createdAt: string; id: string } | null;
  limit: number;
}

export async function getRevenueEvents(
  supabase: Db,
  query: RevenueEventsQuery,
): Promise<{ rows: RevenueEventRow[] | null }> {
  const { data, error } = await supabase.rpc("admin_revenue_events", {
    p_tenant: query.tenantId,
    p_from: query.from,
    p_to: query.to,
    p_product: null,
    // Keyset: el cursor es el par (received_at, id) del último de la página
    // anterior. Nunca offset (§6 de ARQUITECTURA).
    p_cursor_at: query.cursor?.createdAt ?? null,
    p_cursor_id: query.cursor?.id ?? null,
    p_limit: query.limit,
  } as never);

  if (error) {
    console.error("[ingresos] admin_revenue_events falló:", error.message);
    return { rows: null };
  }
  return { rows: (data ?? []) as unknown as RevenueEventRow[] };
}
