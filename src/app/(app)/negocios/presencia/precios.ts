import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { findPrice, type ResolvedPrice } from "@/lib/pricing";
import { getTenantPrices } from "@/lib/pricing/read";
import { PLAN_IDS, type Intervalo, type PlanId } from "@/lib/stripe";
import type { Database } from "@/lib/types/database.types";

/**
 * =============================================================================
 * LOS SEIS PRECIOS DE PRESENCIA VERIFICADA — una sola lectura para toda la
 * pantalla y para el Checkout
 * =============================================================================
 *
 * Existe para que la vista previa y el cobro NO puedan divergir. Antes la
 * pantalla leía `plan.precioMensualUsd` (un número en USD dentro de la
 * constante) y la action leía `montoCentavos(plan, intervalo)`: dos caminos
 * distintos hacia el mismo precio, que coincidían por casualidad porque salían
 * del mismo objeto. Ahora los dos entran por `getTenantPrices` con el mismo
 * `tenant_id`, así que el número grande de la tarjeta y el `unit_amount` que
 * viaja a Stripe son literalmente la misma fila de `tenant_prices` (o la misma
 * constante de respaldo, cuando la comunidad no configuró nada).
 *
 * CENTAVOS ENTEROS de punta a punta. El único lugar donde aparece una división
 * es el "por mes" del plan anual, y ahí se redondea UNA vez, para mostrar —
 * jamás para cobrar (ver `planes-presencia.tsx`).
 */

/** Los 6 precios vigentes de Presencia, indexados por plan e intervalo. */
export type PreciosPresencia = Record<PlanId, Record<Intervalo, ResolvedPrice>>;

const INTERVALOS: readonly Intervalo[] = ["mensual", "anual"];

export async function leerPreciosPresencia(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<PreciosPresencia> {
  const prices = await getTenantPrices(supabase, tenantId);

  // `findPrice` sólo devuelve `null` para una casilla que no existe en el
  // catálogo, y las seis de Presencia existen (hay un test que compara el
  // catálogo contra la migración 0072 fila por fila). El `!` sería más corto;
  // el filtro explícito deja el tipo honesto sin inventar un precio cero.
  const result = {} as PreciosPresencia;
  for (const planId of PLAN_IDS) {
    const porIntervalo = {} as Record<Intervalo, ResolvedPrice>;
    for (const intervalo of INTERVALOS) {
      const price = findPrice(prices, "presencia", planId, intervalo);
      if (price) porIntervalo[intervalo] = price;
    }
    result[planId] = porIntervalo;
  }
  return result;
}
