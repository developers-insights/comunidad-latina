import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * =============================================================================
 * COMISIÓN DE LA PLATAFORMA, POR COMUNIDAD
 * =============================================================================
 *
 * Hasta la 0087 el 20% estaba escrito en el código: `proposeContract` insertaba
 * el contrato sin tocar `fee_pct` y se quedaba con el DEFAULT de la columna. Una
 * comunidad que quisiera cobrar 15% —o nada— necesitaba un deploy. El pliego
 * pide lo contrario, con las mismas palabras que motivaron 0064 y 0086: los
 * números van en el panel, no en el código.
 *
 * -----------------------------------------------------------------------------
 * QUIÉN CALCULA EL SPLIT (la parte que importa)
 * -----------------------------------------------------------------------------
 * La base. `gig_contracts.platform_fee_cents` y `creator_net_cents` son columnas
 * GENERADAS: se calculan solas al insertar y no hay forma de que la app escriba
 * un valor distinto. Este módulo NO las reemplaza.
 *
 * `splitCents` existe para PREVISUALIZAR — mostrarle a quien está armando el
 * contrato cuánto va a cobrar el creador ANTES de que la fila exista. Por eso su
 * única obligación es dar EXACTAMENTE lo mismo que va a dar la base:
 *
 *     Postgres:  ((amount_cents::bigint * fee_pct) / 100)::int
 *     acá:       Math.trunc((amountCents * feePct) / 100)
 *
 * La división entera de Postgres TRUNCA hacia cero (no redondea al más cercano,
 * no aplica banker's rounding), y `Math.trunc` hace lo mismo. Con montos y
 * porcentajes positivos —los únicos que los CHECK de 0024 dejan pasar— truncar y
 * pisar coinciden, pero se usa `trunc` igual porque es la operación que la base
 * hace de verdad, no una que da lo mismo por casualidad.
 *
 * El neto se define como la RESTA, igual que en la base: con dos truncamientos
 * independientes, fee + net dejaría de sumar el monto exacto y faltaría o
 * sobraría un centavo. Ese centavo es el que después aparece en un reclamo.
 *
 * SI ALGUNA VEZ DIFIEREN, MANDA LA BASE. Para mostrar un contrato YA CREADO no
 * se usa este módulo sino `components/creators/money.ts#contractBreakdown`, que
 * lee las columnas generadas y no recalcula nada.
 *
 * -----------------------------------------------------------------------------
 * DEGRADACIÓN
 * -----------------------------------------------------------------------------
 * `getCreatorCommission` nunca lanza y nunca devuelve NULL. Si la base no
 * responde, si la función todavía no está migrada o si el tenant no tiene fila,
 * devuelve 20 — que es exactamente lo que la app hacía hardcodeado hasta 0087,
 * así que "no pude leer la config" no cambia el comportamiento de nadie.
 */

/** Lo que la app cobró siempre, y lo que rige si no hay configuración. */
export const DEFAULT_FEE_PCT = 20;

/** El mismo rango que los CHECK de `gig_contracts.fee_pct` y de la config. */
const MIN_FEE_PCT = 0;
const MAX_FEE_PCT = 50;

export interface ContractSplit {
  /** Lo que retiene la plataforma, en centavos. */
  platformFeeCents: number;
  /** Lo que cobra el creador, en centavos. Siempre `amountCents − fee`. */
  creatorNetCents: number;
}

/**
 * Normaliza un `fee_pct` venido de cualquier lado (RPC, form, JSON) al entero
 * 0..50 que la base acepta. Cualquier cosa fuera de rango, decimal, negativa,
 * NaN o de otro tipo cae al default: un porcentaje inválido no puede convertirse
 * en "no cobramos nada" ni en "cobramos todo".
 */
export function normalizeFeePct(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_FEE_PCT;

  const rounded = Math.round(value);
  if (rounded < MIN_FEE_PCT || rounded > MAX_FEE_PCT) return DEFAULT_FEE_PCT;
  return rounded;
}

/**
 * El split del contrato, idéntico al que va a generar la base.
 *
 * Puro y sin efectos: sirve para previsualizar y para testear. No persiste nada
 * — las columnas de `gig_contracts` son generadas y no se escriben desde la app.
 */
export function splitCents(amountCents: number, feePct: number): ContractSplit {
  const amount = Number.isFinite(amountCents) ? Math.trunc(amountCents) : 0;
  const pct = normalizeFeePct(feePct);

  // Mismo orden de operaciones que la columna generada: multiplicar primero,
  // dividir después. Dividir primero (amount * (pct/100)) arrastraría el error
  // binario de 0.2 y daría un centavo de diferencia en montos redondos.
  const platformFeeCents = Math.trunc((amount * pct) / 100);

  return { platformFeeCents, creatorNetCents: amount - platformFeeCents };
}

/**
 * Trae la comisión vigente de la comunidad actual.
 *
 * El `tenant_id` NO se pasa por parámetro a propósito: la función de la base lo
 * deriva de `app.current_tenant_id()`, que sale del JWT. Aceptarlo desde la app
 * sería exactamente el agujero multi-tenant que el resto del repo evita.
 *
 * Hay que llamarla con el cliente DEL USUARIO, no con el admin: el cliente admin
 * no lleva JWT, así que `app.current_tenant_id()` daría null y la función
 * devolvería el default sin importar cómo esté configurada la comunidad.
 */
export async function getCreatorCommission(
  client: SupabaseClient<Database>,
): Promise<number> {
  try {
    // `get_creator_commission` llega con la 0087 y `database.types.ts` se
    // regenera aparte: el cast es por el TIPO generado, no por el contrato.
    // Mismo patrón que `lib/integrity/settings.ts` con la 0086.
    const open = client as unknown as SupabaseClient;
    const { data, error } = await open.rpc("get_creator_commission");

    if (error) {
      console.warn("[creadores] no se pudo leer la comisión; va el default", {
        code: error.code,
      });
      return DEFAULT_FEE_PCT;
    }

    // La función devuelve un escalar; PostgREST puede entregarlo suelto o
    // envuelto en un array de una fila.
    return normalizeFeePct(Array.isArray(data) ? data[0] : data);
  } catch (error) {
    console.warn("[creadores] lectura de comisión fallida; va el default", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
    return DEFAULT_FEE_PCT;
  }
}
