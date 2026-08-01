import type Stripe from "stripe";

/**
 * =============================================================================
 * SUSCRIPCIONES DE STRIPE — lectura del objeto, compartida por los dos productos
 * =============================================================================
 *
 * Módulo PURO (sin `server-only`, sin SDK instanciado, sin Supabase): son tres
 * funciones que leen un objeto plano. Se testean sin red y sin claves.
 *
 * Vive acá y no dentro de un producto porque HOY hay dos suscripciones —la
 * membresía de tienda (0048) y el premium de un aviso (0054)— y mañana puede
 * haber tres. La forma del objeto `Subscription` es del SDK, no del producto: si
 * cada módulo la lee a su manera, el día que Stripe la vuelva a mover hay que
 * acordarse de arreglar N lugares, y el que se olvide es el que factura mal.
 */

/** Estados de Stripe que mantienen el beneficio pago encendido. */
const ACTIVE_SUB_STATUSES: ReadonlyArray<Stripe.Subscription.Status> = [
  "active",
  "trialing",
];

/** Los 4 estados que la app persiste (CHECK de 0048 y de 0054). */
export type BillingStatus = "active" | "past_due" | "canceled" | "expired";

/**
 * Traduce un `Subscription.status` de Stripe (9 valores) a los 4 que guardamos.
 *
 * `unpaid` cae en `past_due` y no en `expired` a propósito: es un cobro que
 * todavía se está reintentando. Apagar lo que alguien paga por un rebote de
 * tarjeta —cuando Stripe todavía no se dio por vencido— es un castigo que no
 * corresponde. Cuando Stripe SÍ se da por vencido manda
 * `customer.subscription.deleted`, y ahí sí se apaga.
 */
export function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status,
): BillingStatus {
  if (ACTIVE_SUB_STATUSES.includes(status)) return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled") return "canceled";
  // incomplete / incomplete_expired / paused: nunca llegó a haber un período
  // pagado, así que el beneficio no se muestra.
  return "expired";
}

/**
 * Fin del período pagado, en ISO.
 *
 * ⚠️ EL ERROR QUE ESTE REPO YA PAGÓ UNA VEZ. En la API que usa stripe-node 22
 * (2025-10-29.clover), `current_period_end` YA NO vive en la `Subscription`: se
 * movió a cada `SubscriptionItem`. Leerlo del objeto raíz —como enseñan casi
 * todos los ejemplos viejos y como sigue apareciendo en medio internet— devuelve
 * `undefined`, deja la columna en NULL, el cron nunca vence la fila y el
 * beneficio queda prendido para siempre. Verificado contra la definición actual
 * del SDK antes de escribir esta línea.
 *
 * Se toma el ítem que vence MÁS TARDE: con varios ítems, apagar en el primero
 * sería cortar algo que todavía está pago.
 */
export function periodEndFromSubscription(
  subscription: Stripe.Subscription,
): string | null {
  const ends = (subscription.items?.data ?? [])
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (ends.length === 0) return null;
  return new Date(Math.max(...ends) * 1000).toISOString();
}

/**
 * ¿Está programada para NO renovar?
 *
 * Cancelar en el portal de Stripe no apaga nada en el momento: manda
 * `customer.subscription.updated` con `cancel_at_period_end: true` y el status
 * TODAVÍA en `active`. El beneficio sigue hasta que termine lo que se cobró
 * —que es lo correcto— pero la pantalla del dueño necesita este dato para decir
 * "seguís premium hasta el 12 de marzo" en vez de un "activo" que después se
 * apaga sin aviso.
 */
export function cancelsAtPeriodEnd(subscription: Stripe.Subscription): boolean {
  return subscription.cancel_at_period_end === true;
}
