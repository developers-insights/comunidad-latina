import "server-only";

import type Stripe from "stripe";
import {
  diagnosticoDeCobro,
  metadataString,
  motivoDeDiscrepancia,
  pactadoFromMetadata,
} from "@/lib/monetization/pactado";
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

/*
 * `metadataString` VIVÍA acá, copiada. Ahora sale de `@/lib/monetization/pactado`
 * junto a las tres funciones que deciden si un cobro se acepta: la regla de qué
 * es "lo pactado" ya la comparten cinco productos y cada copia local era una
 * oportunidad más de que divergieran.
 */

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
 *
 * CORRELACIÓN OBLIGATORIA (fiscal R3), en dos partes y en este orden:
 *   (a) LA TIENDA existe, es de este tenant y sigue siendo del `owner_id` que
 *       compró (abajo).
 *   (b) EL MONTO Y LA MONEDA cobrados son los PACTADOS al abrir la Session.
 * Es la MISMA disciplina que `premium-webhook.ts` sobre el aviso y que
 * `activateVerifiedPresence` sobre la cuenta de negocio. Discrepancia → log de
 * ALERTA y NO se concede, SIN throw.
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

  // (a) LA TIENDA TIENE QUE EXISTIR Y SER DE QUIEN COMPRÓ.
  //
  // POR QUÉ, SI YA LO VALIDÓ LA ACTION
  // `activarMembresiaTienda` exige `created_by = user.id` antes de abrir la
  // Session, y la metadata vuelve firmada por Stripe: por ese camino no hay
  // ataque. Lo que esto cubre es el HUECO DE TIEMPO — el `upsert` iba a ciegas
  // sobre `store_id`, así que una tienda borrada o transferida entre el checkout
  // y el webhook (minutos, o días con un pago diferido) le concedía la membresía
  // al DUEÑO VIEJO: la fila se escribe con el `owner_id` de la metadata, no con
  // el dueño real. Es defensa en profundidad, la misma que ya tienen los otros
  // dos productos por suscripción; el día que un segundo camino abra estos
  // Checkouts, el chequeo ya está puesto.
  //
  // POR QUÉ NO SE VERIFICA TAMBIÉN `kind='business'`
  // Deliberado. La tienda es un `listing kind='business'` y la action lo exige,
  // pero un `kind` distinto no sería plata mal cobrada: sería un dato raro. Cada
  // condición de más es una forma más de RECHAZAR UN PAGO LEGÍTIMO, que de cara
  // al usuario es peor que el hueco. Se verifican las tres que importan y que
  // hacen los otros dos productos: existe, tenant, dueño.
  const { data: store, error: storeError } = await admin
    .from("listings")
    .select("id, tenant_id, created_by")
    .eq("id", storeId)
    .maybeSingle();
  // Un fallo de LECTURA no es "la tienda no existe": lanza para que el reintento
  // de Stripe lo reprocese. Tragarlo sería no conceder algo ya pagado.
  if (storeError) throw new Error(`select listings: ${storeError.code}`);
  if (!store || store.tenant_id !== tenantId || store.created_by !== ownerId) {
    console.error(
      `[marketplace:membresia:webhook] ALERTA: la session ${session.id} pagó por la tienda ${storeId}, que no existe, no es del tenant ${tenantId} (tenant real: ${
        store?.tenant_id ?? "—"
      }) o cambió de dueño (dueño real: ${
        store?.created_by ?? "—"
      } ≠ metadata ${ownerId}) — NO se activa. ${diagnosticoDeCobro(session)}. Revisar refund en el Dashboard.`,
    );
    return;
  }

  // (b) CORRELACIÓN (misma disciplina que activateBoost y que el premium de un
  // aviso, fiscal R3): el monto Y LA MONEDA cobrados tienen que ser los
  // PACTADOS al abrir esta Session. Si no coinciden, NO se activa y queda el
  // payload en payment_events para reconciliar a mano — reintentar no arregla
  // una discrepancia de monto.
  //
  // POR QUÉ YA NO HAY RESPALDO A `MEMBERSHIP_PRICE_CENTS`
  // Ese respaldo ERA el bug que se arregló en el premium, replicado acá: con una
  // comunidad cobrando USD 25, el Checkout cobraba 2500, este handler comparaba
  // contra la constante 1000 y no activaba nunca — plata cobrada, tienda
  // apagada. Y al revés, conceder igual cuando no hay precio legible, sería
  // peor: un Checkout manipulado pagaría un centavo y encendería la tienda. Sin
  // precio pactado no se concede, y el log de abajo deja el rastro para
  // reconciliar. (Ver `lib/monetization/pactado.ts` para el porqué completo de
  // verificar contra la metadata y no contra `tenant_prices`.)
  const pactado = pactadoFromMetadata(session.metadata);
  if (!pactado) {
    console.error(
      `[marketplace:membresia:webhook] ALERTA: la session ${session.id} (tienda ${storeId}) no trae un precio pactado legible en metadata — NO se activa. ${diagnosticoDeCobro(session)}. Reconciliar a mano en el Dashboard.`,
    );
    return;
  }

  // Monto Y MONEDA (ver `motivoDeDiscrepancia`): 1500 ARS y 1500 USD dan el
  // mismo entero y no son el mismo cobro.
  const discrepancia = motivoDeDiscrepancia(session, pactado);
  if (discrepancia) {
    console.error(
      `[marketplace:membresia:webhook] ALERTA: la session ${session.id} (tienda ${storeId}) ${discrepancia} — NO se activa. ${diagnosticoDeCobro(session)}.`,
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
      // Lo que efectivamente se cobró queda ESCRITO en la fila. Sin esto, una
      // reactivación con un precio distinto al de la spec se comparaba contra
      // el default de la columna (1000) y se rechazaba sola.
      price_cents: pactado.cents,
      currency: pactado.currency,
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
