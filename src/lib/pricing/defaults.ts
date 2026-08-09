import "server-only";

import {
  BOOST_PACKAGES,
  PLANES_PRESENCIA,
  POST_PROMO_PACKAGES,
  boostMontoCentavos,
  montoCentavos,
  postPromoMontoCentavos,
} from "@/lib/stripe";
import { PREMIUM_LISTING_PRICE_CENTS } from "@/lib/monetization/premium";
import { MEMBERSHIP_PRICE_CENTS } from "@/components/marketplace/membership";
import { PRICE_SLOTS, slotKey } from "./catalog";

/**
 * =============================================================================
 * LOS PRECIOS DE RESPALDO — las constantes del código, en forma de mapa
 * =============================================================================
 *
 * Esto NO es una segunda lista de precios: es la MISMA, leída de donde ya vivía.
 * Cada monto se calcula con la función que ya usa el Checkout
 * (`montoCentavos`, `boostMontoCentavos`, `postPromoMontoCentavos`) en vez de
 * copiarse a mano. Copiar un precio es cómo se termina cobrando dos números
 * distintos por el mismo producto según qué archivo lo leyó.
 *
 * PARA QUÉ SIRVE
 *   Es lo que rige cuando una comunidad no tiene fila en `tenant_prices` — un
 *   tenant recién creado, o una casilla que nadie configuró todavía. Gracias a
 *   esto no existe una ventana en la que el Checkout no sepa cuánto cobrar
 *   (ver la cabecera de la migración 0072).
 *
 * `server-only` porque `@/lib/stripe` lo es: ese módulo construye el cliente de
 * Stripe y no puede terminar en un bundle del navegador. El editor del panel
 * recibe estos números YA RESUELTOS como props desde el Server Component —
 * nunca importa este archivo.
 */

export interface FallbackPrice {
  amountCents: number;
  currency: string;
}

/** Todo lo que hoy se cobra está en dólares. La base igual lo guarda explícito. */
const FALLBACK_CURRENCY = "USD";

/**
 * Mapa `producto:variante:intervalo` → monto. Cubre las 14 casillas de
 * `PRICE_SLOTS`; hay un test que falla si alguna queda sin respaldo.
 */
export const FALLBACK_PRICES: ReadonlyMap<string, FallbackPrice> = new Map([
  // Presencia Verificada — los montos salen de PLANES_PRESENCIA vía la misma
  // función que arma el Checkout, así que el anual sigue siendo 10× el mensual
  // sin que nadie tenga que acordarse de la regla.
  [
    slotKey({ product: "presencia", variant: "basico", interval: "mensual" }),
    { amountCents: montoCentavos(PLANES_PRESENCIA.basico, "mensual"), currency: FALLBACK_CURRENCY },
  ],
  [
    slotKey({ product: "presencia", variant: "basico", interval: "anual" }),
    { amountCents: montoCentavos(PLANES_PRESENCIA.basico, "anual"), currency: FALLBACK_CURRENCY },
  ],
  [
    slotKey({ product: "presencia", variant: "destacado", interval: "mensual" }),
    {
      amountCents: montoCentavos(PLANES_PRESENCIA.destacado, "mensual"),
      currency: FALLBACK_CURRENCY,
    },
  ],
  [
    slotKey({ product: "presencia", variant: "destacado", interval: "anual" }),
    { amountCents: montoCentavos(PLANES_PRESENCIA.destacado, "anual"), currency: FALLBACK_CURRENCY },
  ],
  [
    slotKey({ product: "presencia", variant: "pro", interval: "mensual" }),
    { amountCents: montoCentavos(PLANES_PRESENCIA.pro, "mensual"), currency: FALLBACK_CURRENCY },
  ],
  [
    slotKey({ product: "presencia", variant: "pro", interval: "anual" }),
    { amountCents: montoCentavos(PLANES_PRESENCIA.pro, "anual"), currency: FALLBACK_CURRENCY },
  ],

  // Impulso de un aviso — BOOST_PACKAGES.
  [
    slotKey({ product: "boost", variant: "7d", interval: "unico" }),
    { amountCents: boostMontoCentavos(BOOST_PACKAGES["7d"]), currency: FALLBACK_CURRENCY },
  ],
  [
    slotKey({ product: "boost", variant: "14d", interval: "unico" }),
    { amountCents: boostMontoCentavos(BOOST_PACKAGES["14d"]), currency: FALLBACK_CURRENCY },
  ],
  [
    slotKey({ product: "boost", variant: "30d", interval: "unico" }),
    { amountCents: boostMontoCentavos(BOOST_PACKAGES["30d"]), currency: FALLBACK_CURRENCY },
  ],

  // Campaña de una publicación — POST_PROMO_PACKAGES.
  [
    slotKey({ product: "post_promo", variant: "7d", interval: "unico" }),
    { amountCents: postPromoMontoCentavos(POST_PROMO_PACKAGES["7d"]), currency: FALLBACK_CURRENCY },
  ],
  [
    slotKey({ product: "post_promo", variant: "14d", interval: "unico" }),
    { amountCents: postPromoMontoCentavos(POST_PROMO_PACKAGES["14d"]), currency: FALLBACK_CURRENCY },
  ],
  [
    slotKey({ product: "post_promo", variant: "30d", interval: "unico" }),
    { amountCents: postPromoMontoCentavos(POST_PROMO_PACKAGES["30d"]), currency: FALLBACK_CURRENCY },
  ],

  // Membresía de tienda — la constante que ya usa el Checkout del marketplace.
  [
    slotKey({ product: "store_membership", variant: "estandar", interval: "mensual" }),
    { amountCents: MEMBERSHIP_PRICE_CENTS, currency: FALLBACK_CURRENCY },
  ],

  // Publicación premium autoservicio (0054).
  [
    slotKey({ product: "listing_premium", variant: "estandar", interval: "mensual" }),
    { amountCents: PREMIUM_LISTING_PRICE_CENTS, currency: FALLBACK_CURRENCY },
  ],
]);

/** ¿Quedó alguna casilla del catálogo sin respaldo? Lo usa el test. */
export function slotsWithoutFallback(): string[] {
  return PRICE_SLOTS.map(slotKey).filter((key) => !FALLBACK_PRICES.has(key));
}
