import "server-only";
import type Stripe from "stripe";

const METADATA_KEY = "uso";
const METADATA_VALUE = "suscripciones-comunidad";

let cachedId: string | null = null;

/**
 * Los precios son `price_data` inline y los webhooks no toman el plan de un
 * `subscription.updated`: si el portal deja cambiar de plan, Stripe cobra el
 * plan nuevo y la app sigue dando el viejo. Por eso el cambio de plan va
 * apagado, y la cancelación es al fin del período porque así lo promete
 * /legal/reembolsos. La config se busca por metadata antes de crearla para no
 * sumar una por cada cold start.
 *
 * Si Stripe falla devuelve `undefined` y el portal abre con la config default
 * del Dashboard: peor que la nuestra, mejor que no dejar cancelar.
 */
export async function portalConfigurationId(stripe: Stripe): Promise<string | undefined> {
  if (cachedId) return cachedId;
  try {
    const existentes = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
    const propia = existentes.data.find((c) => c.metadata?.[METADATA_KEY] === METADATA_VALUE);
    if (propia) {
      cachedId = propia.id;
      return cachedId;
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";
    const creada = await stripe.billingPortal.configurations.create({
      business_profile: {
        privacy_policy_url: `${siteUrl}/legal/privacidad`,
        terms_of_service_url: `${siteUrl}/legal/terminos`,
      },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
        subscription_update: { enabled: false },
        customer_update: { enabled: false },
      },
      metadata: { [METADATA_KEY]: METADATA_VALUE },
    });
    cachedId = creada.id;
    return cachedId;
  } catch (error) {
    console.error(
      "[pagos] No se pudo obtener la configuración del portal; se usa la default del Dashboard",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

export function __resetPortalConfigCache() {
  cachedId = null;
}
