/**
 * =============================================================================
 * PREMIUM DE UNA PUBLICACIÓN — autoservicio gratis → premium (0054)
 * =============================================================================
 *
 * Módulo PURO, igual que `tier.ts`: sin DOM, sin Supabase, sin el SDK de Stripe.
 * Todo lo que decide "¿este aviso está premium?" y "¿qué le muestro al dueño?"
 * se puede testear sin red y sin una sola credencial — que es exactamente lo que
 * hace falta hoy, porque no hay clave de Stripe con la que probar en vivo.
 *
 * DÓNDE VIVE LA VERDAD, EN ORDEN DE AUTORIDAD (la misma doctrina de tier.ts):
 *
 *   1. LA BASE (0054). `app.mirror_listing_tier()` traduce el estado de la
 *      suscripción a `listings.tier` y, en la baja, limpia los 7 botones tras
 *      guardarlos. Ni PostgREST ni una server action con bug pueden saltearlo:
 *      `app.protect_listing_counters()` (0048) le prohíbe al dueño tocar `tier`.
 *   2. EL WEBHOOK (`premium-webhook.ts`) es el ÚNICO que escribe
 *      `listing_premiums` — las 3 policies de escritura están en `false`.
 *   3. ESTE ARCHIVO sólo LEE y presenta. Si alguna función de acá decidiera un
 *      tier, tendríamos dos fuentes de verdad para lo que se cobra.
 *
 * `statusKeepsListingPremium` es un ESPEJO literal del trigger. Si las dos se
 * separan, la app le miente al dueño sobre lo que la comunidad está viendo —el
 * mismo riesgo que documenta `statusKeepsStoreOn` para las tiendas.
 */

import { COPY } from "./copy";
import type { ListingTier } from "./tier";

// ---------------------------------------------------------------------------
// Precio
// ---------------------------------------------------------------------------

/**
 * [EJEMPLO §18] USD 9/mes. Espeja el default de `listing_premiums.price_cents`.
 *
 * El precio REAL es una decisión comercial humana previa al go-live. Vive como
 * default de fila (y no en un CHECK) justamente para que cambiarlo sea una fila
 * nueva y no una migración. Referencia de vecindario: la membresía de tienda son
 * USD 10/mes y el plan Básico de Presencia Verificada, USD 19/mes.
 */
export const PREMIUM_LISTING_PRICE_CENTS = 900;
export const PREMIUM_LISTING_CURRENCY = "usd";

/** USD enteros o con centavos, para mostrar. */
export const PREMIUM_LISTING_PRICE_USD = PREMIUM_LISTING_PRICE_CENTS / 100;

// ---------------------------------------------------------------------------
// Estado de la suscripción
// ---------------------------------------------------------------------------

/** Espeja el CHECK de `listing_premiums.status` (0054). */
export const PREMIUM_STATUSES = ["active", "past_due", "canceled", "expired"] as const;
export type PremiumStatus = (typeof PREMIUM_STATUSES)[number];

export function parsePremiumStatus(raw: unknown): PremiumStatus | null {
  return PREMIUM_STATUSES.includes(raw as PremiumStatus) ? (raw as PremiumStatus) : null;
}

/**
 * ¿Este estado deja el aviso en premium? ESPEJO EXACTO de
 * `app.mirror_listing_tier()`.
 *
 * `past_due` NO baja el aviso a propósito: un cobro que rebotó da margen para
 * cambiar la tarjeta, no le apaga los botones a un comercio en el acto. Cuando
 * Stripe se da por vencido manda `customer.subscription.deleted` y ahí sí baja.
 */
export function statusKeepsListingPremium(status: PremiumStatus): boolean {
  return status === "active" || status === "past_due";
}

/** El tier que la base va a terminar escribiendo para este estado. */
export function tierForPremiumStatus(status: PremiumStatus): ListingTier {
  return statusKeepsListingPremium(status) ? "premium" : "free";
}

// ---------------------------------------------------------------------------
// Lo que ve el dueño
// ---------------------------------------------------------------------------

/**
 * `none` es un estado real y frecuente: el aviso existe desde antes que el
 * premium, o nunca se pagó. No es lo mismo que `expired` —a ese SÍ se le cobró
 * alguna vez— y por eso el copy y los botones son distintos.
 *
 * `canceling` no existe en la base: es `active` + `cancel_at_period_end`. Se
 * separa acá porque para la persona son dos situaciones distintas ("se renueva
 * sola" vs. "se termina el 12 de marzo") y merecen dos frases distintas.
 */
export type PremiumView = "none" | "active" | "canceling" | "past_due" | "ended";

export interface PremiumRow {
  status: unknown;
  cancel_at_period_end?: boolean | null;
  current_period_end?: string | null;
  stripe_customer_id?: string | null;
}

/** Fila (o ausencia de fila) → el estado que se le muestra a la persona. */
export function premiumViewFor(row: PremiumRow | null | undefined): PremiumView {
  const status = parsePremiumStatus(row?.status);
  if (!row || !status) return "none";
  if (status === "past_due") return "past_due";
  if (!statusKeepsListingPremium(status)) return "ended";
  return row.cancel_at_period_end ? "canceling" : "active";
}

export type PremiumTone = "success" | "warning" | "danger" | "neutral";

export interface PremiumPresentation {
  view: PremiumView;
  tone: PremiumTone;
  /** `null` en `none`: ahí no hay tarjeta de estado, hay una oferta. */
  title: string | null;
  body: string | null;
  /** ¿Se ofrece abrir un Checkout NUEVO? */
  canActivate: boolean;
  /** ¿Se ofrece el portal de facturación (tarjeta, reanudar, cancelar)? */
  canManage: boolean;
  /** Etiqueta del botón de alta, según sea primera vez o reactivación. */
  activateLabel: string;
}

/**
 * Qué mostrar, botones incluidos.
 *
 * LA REGLA QUE EVITA EL DOBLE COBRO: con una suscripción VIVA en Stripe
 * (`active`, `canceling` o `past_due`) `canActivate` es false. Abrir un Checkout
 * nuevo ahí crearía una SEGUNDA suscripción sobre el mismo aviso y la persona
 * pagaría dos veces por lo mismo. Reanudar una cancelación programada, cambiar
 * la tarjeta o cancelar de verdad se hacen en el portal, que es donde Stripe
 * garantiza que sigue siendo una sola.
 */
export function premiumPresentation(
  row: PremiumRow | null | undefined,
  formatDate: (iso: string) => string,
): PremiumPresentation {
  const view = premiumViewFor(row);
  const C = COPY.premium;
  const hasBilling = Boolean(row?.stripe_customer_id);
  const periodEnd = row?.current_period_end ?? null;

  switch (view) {
    case "active":
      return {
        view,
        tone: "success",
        title: C.statusActiveTitle,
        body: periodEnd
          ? C.statusActiveBody(formatDate(periodEnd))
          : C.statusActiveBodyNoDate,
        canActivate: false,
        canManage: true,
        activateLabel: C.reactivateCta,
      };

    case "canceling":
      return {
        view,
        tone: "warning",
        // Sin fecha el título perdería su sentido ("Premium hasta el ..."), así
        // que se cae al de activa: es preferible una frase menos precisa que una
        // frase rota.
        title: periodEnd ? C.statusCancelingTitle(formatDate(periodEnd)) : C.statusActiveTitle,
        body: C.statusCancelingBody,
        canActivate: false,
        canManage: true,
        activateLabel: C.reactivateCta,
      };

    case "past_due":
      return {
        view,
        tone: "danger",
        title: C.statusPastDueTitle,
        body: C.statusPastDueBody,
        canActivate: false,
        canManage: true,
        activateLabel: C.reactivateCta,
      };

    case "ended":
      return {
        view,
        tone: "neutral",
        title: C.statusEndedTitle,
        body: C.statusEndedBody,
        canActivate: true,
        canManage: hasBilling,
        activateLabel: C.reactivateCta,
      };

    case "none":
      return {
        view,
        tone: "neutral",
        title: null,
        body: null,
        canActivate: true,
        canManage: false,
        activateLabel: C.activateCta,
      };
  }
}
