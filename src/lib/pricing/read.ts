import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { FALLBACK_PRICES } from "./defaults";
import {
  findPrice,
  resolvePrices,
  type PriceInterval,
  type PriceProduct,
  type ResolvedPrice,
  type TenantPriceRow,
} from "./catalog";

/**
 * =============================================================================
 * LECTURA DE PRECIOS — la base manda, la constante respalda
 * =============================================================================
 *
 * El único camino por el que la aplicación se entera de cuánto cobrar.
 *
 * LA REGLA, COMPLETA
 *   1. Si hay fila activa en `tenant_prices` para esa comunidad → rige la fila.
 *   2. Si no hay fila, está apagada, o la consulta FALLA → rige la constante
 *      del código (`defaults.ts`).
 *   El punto 2 incluye el error a propósito: una base caída no puede dejar sin
 *   precio al Checkout. Prefiere cobrar el precio de siempre antes que romper
 *   el pago — y deja el error en el log del servidor para que se investigue.
 *
 * SE LEE CON EL CLIENTE DEL USUARIO, no con el admin client. La policy
 * `tenant_prices_select` (0072) ya deja que cualquier miembro lea los precios
 * de su comunidad: es una lista de precios, no un secreto. Usar service_role
 * para esto sería saltear RLS sin ninguna necesidad (§6 de ARQUITECTURA).
 *
 * EL VISITANTE SIN SESIÓN. `tenant_prices_select` es `to authenticated` y filtra
 * por `app.current_tenant_id()`, que sale del JWT. Sin sesión no hay JWT, así que
 * la consulta directa devuelve 0 filas SIN error —RLS filtra en silencio— y el
 * visitante veía la constante del código. Eso importa porque /negocios/presencia
 * y /marketplace/membresia muestran precio a propósito sin pedir cuenta: era un
 * precio antes de entrar y otro después.
 *
 * Por eso, cuando la lectura directa vuelve vacía, se reintenta por
 * `public.tenant_public_prices(tenant_id)` (0078): función acotada que devuelve
 * SOLO los precios activos de ESA comunidad, con el tenant que resuelve el
 * servidor desde el `Host` —nunca uno que elija el visitante—. No se abrió la
 * tabla a `anon`: eso habría expuesto los precios de todas las comunidades.
 */

export type { ResolvedPrice } from "./catalog";

const SELECT = "id, product, variant, billing_interval, amount_cents, currency, active, updated_at";

/**
 * Los 14 precios vigentes de una comunidad, ya resueltos.
 *
 * Nunca lanza y nunca devuelve una lista incompleta: siempre son las 14
 * casillas, con `source` diciendo de dónde salió cada número.
 */
export async function getTenantPrices(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<ResolvedPrice[]> {
  const { data, error } = await supabase
    .from("tenant_prices")
    .select(SELECT)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error(
      `[precios] No se pudieron leer los precios del tenant ${tenantId} — se usan los del código:`,
      error.message,
    );
    return resolvePrices([], FALLBACK_PRICES);
  }

  const rows = (data ?? []) as TenantPriceRow[];
  if (rows.length > 0) return resolvePrices(rows, FALLBACK_PRICES);

  // Vacío puede significar dos cosas distintas: que la comunidad no tenga
  // precios propios (y entonces rigen las constantes, que es correcto), o que
  // quien mira no tenga sesión y RLS haya filtrado todo en silencio. La segunda
  // se distingue preguntando por la puerta que sí atiende a `anon`.
  return resolvePrices(await readPublicPrices(supabase, tenantId), FALLBACK_PRICES);
}

/**
 * Los precios activos de una comunidad por `public.tenant_public_prices` (0078).
 *
 * La función no devuelve `id`, `active` ni `updated_at` —no son de vidriera— así
 * que se completan acá: `active` es `true` por definición (la función ya filtra
 * las apagadas) y el resto queda vacío porque nadie los usa para resolver un
 * precio. Nunca lanza: si falla, devuelve vacío y rigen las constantes.
 */
async function readPublicPrices(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<TenantPriceRow[]> {
  const { data, error } = await supabase.rpc("tenant_public_prices", {
    p_tenant_id: tenantId,
  });

  if (error) {
    console.error(
      `[precios] No se pudieron leer los precios públicos del tenant ${tenantId} — se usan los del código:`,
      error.message,
    );
    return [];
  }

  return (data ?? []).map((row) => ({
    id: "",
    product: row.product,
    variant: row.variant,
    billing_interval: row.billing_interval,
    amount_cents: row.amount_cents,
    currency: row.currency,
    active: true,
    updated_at: null,
  }));
}

/**
 * El monto de UN producto, en centavos, listo para `unit_amount` de Stripe.
 *
 * Es el atajo pensado para las server actions de Checkout: una llamada, un
 * número, sin que el caller tenga que saber que existe una tabla ni un
 * respaldo. Devuelve también la moneda porque un monto sin moneda no es un
 * precio.
 */
export async function getPrice(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  product: PriceProduct,
  variant: string,
  interval: PriceInterval,
): Promise<{ amountCents: number; currency: string; source: "tenant" | "fallback" } | null> {
  const prices = await getTenantPrices(supabase, tenantId);
  const price = findPrice(prices, product, variant, interval);
  if (!price) return null;
  return { amountCents: price.amountCents, currency: price.currency, source: price.source };
}

/** El historial de una comunidad, del cambio más nuevo al más viejo. */
export interface PriceHistoryRow {
  id: string;
  product: string;
  variant: string;
  billing_interval: string;
  old_amount_cents: number | null;
  old_currency: string | null;
  new_amount_cents: number;
  new_currency: string;
  changed_by: string | null;
  changed_at: string;
}

export async function getPriceHistory(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  limit = 20,
): Promise<PriceHistoryRow[] | null> {
  const { data, error } = await supabase
    .from("tenant_price_history")
    .select(
      "id, product, variant, billing_interval, old_amount_cents, old_currency, new_amount_cents, new_currency, changed_by, changed_at",
    )
    .eq("tenant_id", tenantId)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  // `null` significa "no se pudo leer" y la pantalla muestra el hueco. Devolver
  // `[]` diría "no hubo cambios", que es una afirmación distinta y falsa.
  if (error) {
    console.error(`[precios] No se pudo leer el historial del tenant ${tenantId}:`, error.message);
    return null;
  }
  return (data ?? []) as PriceHistoryRow[];
}
