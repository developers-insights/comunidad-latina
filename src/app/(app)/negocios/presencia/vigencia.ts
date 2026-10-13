import "server-only";

import { getStripe } from "@/lib/stripe";
import { periodEndFromSubscription } from "@/lib/stripe/subscription";

export type Vigencia =
  | { tipo: "renueva"; fecha: string }
  | { tipo: "termina"; fecha: string };

/**
 * `business_accounts` no guarda fin de período ni `cancel_at_period_end`, así
 * que la fecha se pregunta a Stripe en vivo. El portal nuevo cancela con
 * `cancel_at` y no siempre con `cancel_at_period_end`: se miran los dos.
 */
export async function leerVigencia(subscriptionId: string): Promise<Vigencia | null> {
  try {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    const finDePeriodo = periodEndFromSubscription(subscription);
    if (subscription.cancel_at) {
      return { tipo: "termina", fecha: new Date(subscription.cancel_at * 1000).toISOString() };
    }
    if (!finDePeriodo) return null;
    return subscription.cancel_at_period_end
      ? { tipo: "termina", fecha: finDePeriodo }
      : { tipo: "renueva", fecha: finDePeriodo };
  } catch (error) {
    console.error(
      `[pagos] No se pudo leer la vigencia de la suscripción ${subscriptionId}`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
