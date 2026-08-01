import "server-only";

import type Stripe from "stripe";
import { createNotification } from "@/lib/notifications/notify";
import {
  mapStripeSubscriptionStatus,
  periodEndFromSubscription,
} from "@/lib/stripe/subscription";
import type { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";

/**
 * =============================================================================
 * MEMBRESÍA DE TIENDA — escritura de estado (service_role)
 * =============================================================================
 *
 * Este módulo es la ÚNICA puerta que escribe `store_memberships`. Vive acá y no
 * dentro de `api/webhooks/stripe/route.ts` por dos motivos:
 *
 *  1. El route handler es infraestructura compartida por varios módulos; meterle
 *     150 líneas de lógica de tiendas lo vuelve el archivo que todos tocan.
 *  2. Así la lógica de la membresía queda junto a la action que abre su
 *     Checkout, que es donde alguien la va a buscar.
 *
 * El route handler sólo importa `handleStoreMembershipEvent` y le pasa el
 * evento; toda la disciplina (idempotencia, correlación, tolerancia) está acá.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO SE TOCA `listings.store_active` DESDE ACÁ
 *
 * `app.mirror_store_active()` (trigger de 0048) la escribe solo, en la misma
 * transacción, cada vez que cambia `store_memberships.status`. Escribirla
 * también desde la app sería una segunda fuente de verdad para el mismo dato —
 * y `app.protect_listing_counters()` la bloquea justamente para que nadie lo
 * intente. Este módulo mueve el status; el espejo se ocupa del resto.
 * -----------------------------------------------------------------------------
 */

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * `mapStripeSubscriptionStatus` y `periodEndFromSubscription` VIVÍAN acá y se
 * mudaron a `@/lib/stripe/subscription` cuando apareció la segunda suscripción
 * del producto (el premium de una publicación, 0054). Leen la forma del objeto
 * de Stripe, no reglas de la tienda: tenerlas duplicadas significaba que el día
 * que Stripe vuelva a mover `current_period_end` —ya lo hizo una vez, y este
 * repo lo pagó— habría que acordarse de arreglar dos archivos.
 *
 * Se siguen re-exportando porque son parte de la superficie pública que este
 * módulo ya ofrecía.
 */
export { mapStripeSubscriptionStatus, periodEndFromSubscription };

function metadataString(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function customerId(
  customer: string | { id: string } | null | undefined,
): string | null {
  if (typeof customer === "string") return customer;
  return customer?.id ?? null;
}

/**
 * ¿Este evento es de una membresía de tienda? El route handler pregunta esto
 * antes de delegar, así los demás flujos de pago no cambian de comportamiento.
 */
export function isStoreMembershipEvent(
  metadata: Stripe.Metadata | null | undefined,
): boolean {
  return metadataString(metadata, "kind") === "store_membership";
}

/* -------------------------------------------------------------------------- */
/* Alta: checkout.session.completed                                           */
/* -------------------------------------------------------------------------- */

/**
 * Crea o reactiva la membresía tras un pago confirmado.
 *
 * `upsert` sobre `store_id` (unique en 0048): una tienda que ya tuvo membresía
 * y venció vuelve a `active` en la MISMA fila, sin duplicar historial. Es
 * idempotente por construcción — un reintento de Stripe reescribe los mismos
 * valores y el trigger del espejo no hace nada porque el estado no cambió.
 */
async function activateFromCheckout(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const tenantId = metadataString(session.metadata, "tenant_id");
  const storeId = metadataString(session.metadata, "store_id");
  const ownerId = metadataString(session.metadata, "owner_id");

  if (!tenantId || !storeId || !ownerId) {
    console.warn(
      "[marketplace:membresia:webhook] checkout sin metadata completa de tienda — se ignora.",
    );
    return;
  }

  // CORRELACIÓN (misma disciplina que activateBoost, fiscal R3): el monto
  // cobrado tiene que ser el de una membresía. Si no coincide, NO se activa y
  // queda el payload en payment_events para reconciliar a mano — reintentar no
  // arregla una discrepancia de monto.
  const { data: priced } = await admin
    .from("store_memberships")
    .select("price_cents")
    .eq("store_id", storeId)
    .maybeSingle();
  const expectedCents = priced?.price_cents ?? 1_000;
  if (typeof session.amount_total === "number" && session.amount_total !== expectedCents) {
    console.error(
      `[marketplace:membresia:webhook] ALERTA: amount_total ${session.amount_total} ≠ esperado ${expectedCents} para la tienda — NO se activa.`,
    );
    return;
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);

  const { error } = await admin.from("store_memberships").upsert(
    {
      tenant_id: tenantId,
      store_id: storeId,
      owner_id: ownerId,
      status: "active",
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId(session.customer),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "store_id" },
  );
  if (error) throw new Error(`upsert store_memberships: ${error.code}`);

  // `current_period_end` llega en el evento de la suscripción, no acá: la
  // Session no lo trae. El cron no toca filas con NULL, así que la ventana
  // entre los dos eventos no apaga nada.

  await createNotification(admin, {
    tenantId,
    profileId: ownerId,
    kind: "store_membership",
    // "pagos" es una de las categorías que no se silencian: es el comprobante
    // de algo que la persona compró, no una promoción.
    category: "pagos",
    ignorePrefs: true,
    title: "Tu tienda ya está en el Marketplace",
    body: "Tu vidriera y tus productos aparecen en las búsquedas de la comunidad. Podés cancelar cuando quieras.",
    href: "/marketplace/membresia",
  });
  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor_id: ownerId,
    action: "store_membership_activated",
    subject_kind: "listing",
    subject_id: storeId,
    meta: { via: "stripe_checkout" },
  });
}

/* -------------------------------------------------------------------------- */
/* Cambios de estado: customer.subscription.*                                 */
/* -------------------------------------------------------------------------- */

/**
 * Sincroniza estado y vencimiento desde la suscripción.
 *
 * El `.eq('stripe_subscription_id')` es la correlación: no se confía en la
 * metadata para decidir A QUÉ FILA aplicar el cambio. Si nadie matchea, es una
 * suscripción que no es nuestra (o un evento anterior al alta) y no se toca
 * nada — sin throw, porque reintentar no la va a hacer aparecer.
 */
async function syncFromSubscription(
  admin: AdminClient,
  subscription: Stripe.Subscription,
  forceStatus?: "canceled",
): Promise<void> {
  const status = forceStatus ?? mapStripeSubscriptionStatus(subscription.status);
  const periodEnd = periodEndFromSubscription(subscription);

  const { data: updated, error } = await admin
    .from("store_memberships")
    .update({
      status,
      ...(periodEnd ? { current_period_end: periodEnd } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id)
    .select("id, tenant_id, owner_id, store_id")
    .maybeSingle();

  if (error) throw new Error(`update store_memberships: ${error.code}`);
  if (!updated) {
    console.warn(
      "[marketplace:membresia:webhook] suscripción sin membresía asociada — se ignora.",
    );
    return;
  }

  // Sólo se avisa cuando la tienda se APAGA: es lo que cambia lo que la
  // comunidad ve, y la persona necesita saberlo para poder volver. Un cobro
  // exitoso mensual no merece una notificación cada 30 días.
  if (status === "canceled" || status === "expired") {
    await createNotification(admin, {
      tenantId: updated.tenant_id,
      profileId: updated.owner_id,
      kind: "store_membership",
      category: "pagos",
      ignorePrefs: true,
      title: "Tu tienda dejó de aparecer en el Marketplace",
      body: "Se terminó tu membresía. Tus productos siguen guardados: al reactivarla, tu tienda vuelve tal como estaba.",
      href: "/marketplace/membresia",
      dedupeUnread: true,
    });
  } else if (status === "past_due") {
    await createNotification(admin, {
      tenantId: updated.tenant_id,
      profileId: updated.owner_id,
      kind: "payment_failed",
      category: "pagos",
      ignorePrefs: true,
      title: "No pudimos cobrar tu membresía",
      body: `Tu tienda sigue visible mientras reintentamos${
        periodEnd ? `, hasta el ${formatDate(new Date(periodEnd), { style: "long" })}` : ""
      }. Actualizá tu tarjeta para no perder la vidriera.`,
      href: "/marketplace/membresia",
      dedupeUnread: true,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Entrada única                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Procesa un evento de Stripe que corresponde a una membresía de tienda.
 *
 * Devuelve `true` si lo manejó (para que el route handler corte ahí) y `false`
 * si el evento no es de este flujo. Lanza sólo ante un error de escritura real:
 * el route handler traduce eso en un 500 y Stripe reintenta.
 */
export async function handleStoreMembershipEvent(
  admin: AdminClient,
  event: Stripe.Event,
): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!isStoreMembershipEvent(session.metadata)) return false;
      // `completed` con pago async todavía no cobrado espera al
      // async_payment_succeeded — no se activa una tienda sin plata adentro.
      if (session.payment_status === "paid") {
        await activateFromCheckout(admin, session);
      }
      return true;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      if (!isStoreMembershipEvent(subscription.metadata)) return false;
      await syncFromSubscription(admin, subscription);
      return true;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      if (!isStoreMembershipEvent(subscription.metadata)) return false;
      // Stripe manda `deleted` tanto por cancelación del dueño como por
      // impago definitivo. Para la tienda el efecto es el mismo: se apaga.
      await syncFromSubscription(admin, subscription, "canceled");
      return true;
    }

    default:
      return false;
  }
}
