"use server";

import { z } from "zod";
import { isStripeConfigured } from "@/lib/config/services";
import { MONETIZATION_COPY } from "@/lib/monetization";
import {
  PREMIUM_LISTING_CURRENCY,
  PREMIUM_LISTING_PRICE_CENTS,
  parsePremiumStatus,
  statusKeepsListingPremium,
} from "@/lib/monetization/premium";
import { selectPremiumByListing } from "@/lib/monetization/premium-db";
import { LISTING_PREMIUM_KIND } from "@/lib/monetization/premium-webhook";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { requireTenantMatch } from "@/lib/tenant/guard";

/**
 * =============================================================================
 * PREMIUM DE UNA PUBLICACIÓN — alta y gestión (autoservicio)
 * =============================================================================
 *
 * Lo que estas actions SÍ hacen: verifican que quien pide sea el dueño de ese
 * aviso y abren la Checkout Session de Stripe (o la del portal para cambiar la
 * tarjeta, reanudar o cancelar).
 *
 * Lo que NUNCA hacen: escribir `listing_premiums` ni tocar `listings.tier`. Las
 * tres policies de escritura de esa tabla están en `false` (0054) y
 * `app.protect_listing_counters()` (0048) le prohíbe el `tier` al dueño. La fila
 * la crea y la mueve SOLO el webhook con service_role. Es la misma doctrina que
 * `boosts` (0016) y `store_memberships` (0048): nadie se activa a sí mismo el
 * estado por el que paga. Si esta action escribiera, cualquiera con la sesión
 * abierta tendría un aviso premium llamando al endpoint.
 *
 * SIN STRIPE CONFIGURADO (que es el estado de producción HOY): se registra el
 * intento sin PII y se devuelve `no_configurado` para que la UI abra
 * `<ProximamentePremium>` (§5.6). El código de Checkout queda completo y listo
 * para el día que exista la clave — no hay una segunda versión que escribir.
 */

const COPY = MONETIZATION_COPY;

const listingSchema = z.object({ listingId: z.uuid() });

export type PremiumResult =
  /** Stripe sin configurar: el cliente abre <ProximamentePremium />. */
  | { status: "no_configurado" }
  /** Sin sesión: el cliente redirige a /entrar. */
  | { status: "sin_sesion" }
  | { status: "error"; message: string }
  /** Checkout/portal creado: el cliente navega a la URL de Stripe. */
  | { status: "redirect"; url: string };

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/**
 * Abre el Checkout del premium (USD 9/mes) para UN aviso propio.
 *
 * EL GUARD QUE EVITA EL DOBLE COBRO va antes de tocar Stripe: si ya hay una
 * suscripción viva (`active` o `past_due`) no se abre un Checkout nuevo. Abrirlo
 * crearía una SEGUNDA suscripción sobre el mismo aviso y la persona pagaría dos
 * veces por lo mismo; el webhook, además, haría upsert sobre la misma fila y una
 * de las dos suscripciones quedaría cobrando sin nada que la represente.
 */
export async function activarPremiumAviso(input: unknown): Promise<PremiumResult> {
  const parsed = listingSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: COPY.errors.generic };
  }
  const { listingId } = parsed.data;

  // Guard PRIMERO: sin coincidencia de tenant no hay nada que cobrar (regla de
  // la casa — nada de efectos huérfanos antes de saber quién pide).
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // El aviso tiene que ser suyo. La RLS ya limita qué filas ve, pero el `.eq` de
  // ownership es explícito: es una decisión de plata, no se deduce.
  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select("id, title, kind, status, created_by")
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .maybeSingle();

  if (listingError) {
    console.warn("[monetizacion:premium] lectura del aviso falló", {
      code: listingError.code,
    });
    return { status: "error", message: COPY.errors.generic };
  }
  if (!listing) return { status: "error", message: COPY.errors.notYours };
  if (listing.status !== "published") {
    return { status: "error", message: COPY.premium.errors.notPublished };
  }

  // Si ya hubo premium, se reusa su customer para que el historial de
  // facturación del comercio no se parta en dos.
  const { data: existing } = await selectPremiumByListing(supabase, listingId);

  const currentStatus = parsePremiumStatus(existing?.status);
  if (currentStatus && statusKeepsListingPremium(currentStatus)) {
    return { status: "error", message: COPY.premium.errors.alreadyActive };
  }

  if (!isStripeConfigured) {
    // Degradación elegante §5.6 — se registra el interés para medir demanda.
    // Sin PII: sólo tenant. (Ni el id del aviso ni el de la persona.)
    console.info(
      `[monetizacion:premium] Intento de alta con Stripe sin configurar — tenant=${tenant.slug}`,
    );
    return { status: "no_configurado" };
  }

  // Abrir Checkouts es barato para nosotros y caro de auditar si alguien lo hace
  // en loop: la cuota va DESPUÉS del guard y ANTES de Stripe.
  if (!limit(`listing-premium:${user.id}`, 10, HOUR_MS).ok) {
    return { status: "error", message: COPY.errors.tooManyTries };
  }

  try {
    const stripe = getStripe();
    const base = siteUrl();
    const metadata = {
      tenant_id: tenant.id,
      listing_id: listingId,
      owner_id: user.id,
      kind: LISTING_PREMIUM_KIND,
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: user.email }),
      line_items: [
        {
          quantity: 1,
          // [EJEMPLO §18] price_data inline con el monto de la spec. Antes del
          // go-live real hay que migrar a un Price del dashboard de Stripe —
          // está en la lista de pasos manuales del handoff.
          price_data: {
            currency: PREMIUM_LISTING_CURRENCY,
            unit_amount: PREMIUM_LISTING_PRICE_CENTS,
            recurring: { interval: "month" },
            product_data: {
              name: `Publicación premium — ${listing.title}`,
              metadata: { listing_id: listingId },
            },
          },
        },
      ],
      metadata,
      // La metadata se repite en la suscripción: los eventos
      // customer.subscription.* NO traen la de la Session, y sin ella el webhook
      // no sabría que la baja es de este flujo.
      subscription_data: { metadata },
      success_url: `${base}/negocios/presencia/aviso/${listingId}?estado=exito`,
      cancel_url: `${base}/negocios/presencia/aviso/${listingId}?estado=cancelado`,
    });

    if (!session.url) {
      console.error(
        `[monetizacion:premium] Checkout Session sin URL — tenant=${tenant.slug}`,
      );
      return { status: "error", message: COPY.errors.generic };
    }
    return { status: "redirect", url: session.url };
  } catch (error) {
    // Nunca un error técnico crudo al usuario (§5.6). Log sin PII.
    console.error(
      `[monetizacion:premium] Error creando Checkout Session — tenant=${tenant.slug}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY.errors.generic };
  }
}

/**
 * Abre el portal de facturación de Stripe: cambiar tarjeta, reanudar o CANCELAR.
 *
 * Cancelar no lo decide esta app: se hace en el portal y vuelve como
 * `customer.subscription.deleted`, que el webhook traduce a `canceled` — el
 * mismo camino que cualquier otro cambio de estado. Prometemos "cancelás cuando
 * quieras" en la pantalla de alta, así que la salida está a un toque y con ese
 * nombre, no escondida en un correo a soporte.
 */
export async function abrirPortalPremiumAviso(input: unknown): Promise<PremiumResult> {
  const parsed = listingSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: COPY.errors.generic };
  }
  const { listingId } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // RLS de listing_premiums: el dueño ve la suya. El `.eq('owner_id')` hace
  // explícito lo que la policy ya garantiza.
  const { data: premium } = await selectPremiumByListing(supabase, listingId, user.id);

  if (!isStripeConfigured) {
    console.info(
      `[monetizacion:premium] Intento de portal con Stripe sin configurar — tenant=${tenant.slug}`,
    );
    return { status: "no_configurado" };
  }

  if (!premium?.stripe_customer_id) {
    return { status: "error", message: COPY.premium.errors.noPortal };
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: premium.stripe_customer_id,
      return_url: `${siteUrl()}/negocios/presencia/aviso/${listingId}`,
    });
    return { status: "redirect", url: session.url };
  } catch (error) {
    console.error(
      `[monetizacion:premium] Error abriendo el portal — tenant=${tenant.slug}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY.errors.generic };
  }
}
