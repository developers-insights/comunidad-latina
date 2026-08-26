import "server-only";

import type Stripe from "stripe";
import { createNotification } from "@/lib/notifications/notify";
import {
  cancelsAtPeriodEnd,
  mapStripeSubscriptionStatus,
  periodEndFromSubscription,
} from "@/lib/stripe/subscription";
import type { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import {
  diagnosticoDeCobro,
  metadataString,
  motivoDeDiscrepancia,
  pactadoFromMetadata,
} from "./pactado";
import { concederUnaSolaVez } from "./concesion";
import { updatePremiumBySubscription, type ListingPremiumUpsert } from "./premium-db";

/**
 * =============================================================================
 * PREMIUM DE UNA PUBLICACIÓN — escritura de estado (service_role)
 * =============================================================================
 *
 * Este módulo es la ÚNICA puerta que escribe `listing_premiums`. Vive en
 * `lib/monetization/` y no dentro del route handler por lo mismo que la
 * membresía de tienda tiene el suyo: el route de webhooks es infraestructura
 * compartida y no debe convertirse en el archivo que todos tocan. Está acá y no
 * junto a la página porque quien busca "¿quién sube `listings.tier`?" abre el
 * módulo de monetización, que es donde vive `tier.ts`.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ACÁ NO SE TOCA `listings.tier` NI SE LIMPIAN LOS BOTONES
 *
 * `app.mirror_listing_tier()` (0054) lo hace solo, en la MISMA transacción, cada
 * vez que cambia `listing_premiums.status`: sube el tier al activar, y al bajar
 * guarda los 7 `cta_*` en `ctas_snapshot` antes de limpiarlos. Escribir eso
 * también desde la app sería una segunda fuente de verdad para el mismo dato —y
 * `app.protect_listing_counters()` bloquea `tier` justamente para que nadie lo
 * intente. Este módulo mueve el status; el espejo se ocupa del resto.
 * -----------------------------------------------------------------------------
 *
 * IDEMPOTENCIA, EN TRES CAPAS (es plata: un evento repetido no puede cobrar ni
 * conceder dos veces):
 *   1. `payment_events.event_id` es UNIQUE — el route handler corta el replay de
 *      un evento ya procesado antes de llegar acá.
 *   2. El `upsert` sobre `listing_id` (unique en 0054) reescribe los MISMOS
 *      valores: repetirlo no duplica nada, y el trigger del espejo tampoco hace
 *      nada porque el estado no cambió.
 *   3. `listing_premiums_checkout_session_uniq` impide que una misma Checkout
 *      Session termine activando dos avisos distintos.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

/** Marca de este flujo en la metadata. Distinta de `store_membership` (0048). */
export const LISTING_PREMIUM_KIND = "listing_premium";

function customerId(
  customer: string | { id: string } | null | undefined,
): string | null {
  if (typeof customer === "string") return customer;
  return customer?.id ?? null;
}

/**
 * ¿Este evento es de un premium de publicación? El route handler pregunta esto
 * antes de delegar, así los demás flujos de pago no cambian de comportamiento.
 */
export function isListingPremiumEvent(
  metadata: Stripe.Metadata | null | undefined,
): boolean {
  return metadataString(metadata, "kind") === LISTING_PREMIUM_KIND;
}

/*
 * `pactadoFromMetadata` VIVÍA acá y se mudó a `./pactado` cuando el segundo
 * producto necesitó la misma regla (Presencia Verificada, en el route handler).
 * Ahí está el porqué completo de comparar contra la metadata y no contra
 * `tenant_prices` ni contra una constante del código.
 */

/* -------------------------------------------------------------------------- */
/* Alta: checkout.session.completed                                           */
/* -------------------------------------------------------------------------- */

/**
 * Concede premium tras un pago confirmado.
 *
 * CORRELACIÓN OBLIGATORIA (fiscal R3, misma disciplina que `activateBoost`): la
 * metadata sola no alcanza. Antes de conceder nada se exige que
 *   (a) el aviso EXISTA, sea de ese tenant y su dueño sea el `owner_id` de la
 *       metadata — si el aviso se borró entre el checkout y el webhook, hay
 *       plata cobrada sin sujeto y eso se reconcilia a mano, no se inventa;
 *   (b) el monto Y LA MONEDA cobrados coincidan con lo PACTADO al abrir el
 *       Checkout (`metadata.price_cents` / `metadata.price_currency`, ver
 *       `pactadoFromMetadata`) — no con una constante del código, que es lo que
 *       rompía el alta de cualquier comunidad con precio propio.
 * Discrepancia → log de ALERTA y NO se concede, SIN throw: reintentar no arregla
 * una discrepancia de monto, y el payload queda en `payment_events` para
 * reconciliar. Lanzar dejaría a Stripe reintentando un evento que nunca va a
 * poder aplicarse.
 */
async function activateFromCheckout(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const tenantId = metadataString(session.metadata, "tenant_id");
  const listingId = metadataString(session.metadata, "listing_id");
  const ownerId = metadataString(session.metadata, "owner_id");

  if (!tenantId || !listingId || !ownerId) {
    console.warn(
      "[monetizacion:premium:webhook] checkout sin metadata completa de aviso — se ignora.",
    );
    return;
  }

  // (a) El aviso tiene que existir y ser de quien dijo la metadata.
  const { data: listing, error: listingError } = await admin
    .from("listings")
    .select("id, tenant_id, created_by")
    .eq("id", listingId)
    .maybeSingle();
  if (listingError) throw new Error(`select listings: ${listingError.code}`);
  if (!listing || listing.tenant_id !== tenantId || listing.created_by !== ownerId) {
    console.error(
      `[monetizacion:premium:webhook] ALERTA: la session ${session.id} pagó por un aviso que no existe o cambió de dueño — NO se concede premium. Revisar refund en el Dashboard.`,
    );
    return;
  }

  // (b) EL MONTO, contra LO PACTADO (ver `pactadoFromMetadata`).
  const pactado = pactadoFromMetadata(session.metadata);
  if (!pactado) {
    // Rastro diagnosticable, no silencio: con esto y el payload que quedó en
    // `payment_events` se sabe qué se cobró, a quién y por qué no se concedió.
    console.error(
      `[monetizacion:premium:webhook] ALERTA: la session ${session.id} (aviso ${listingId}) no trae un precio pactado legible en metadata — NO se concede premium. ${diagnosticoDeCobro(session)}. Reconciliar a mano en el Dashboard.`,
    );
    return;
  }

  // Monto Y MONEDA (ver `motivoDeDiscrepancia`): 1500 ARS y 1500 USD dan el
  // mismo entero y no son el mismo cobro.
  const discrepancia = motivoDeDiscrepancia(session, pactado);
  if (discrepancia) {
    console.error(
      `[monetizacion:premium:webhook] ALERTA: la session ${session.id} (aviso ${listingId}) ${discrepancia} — NO se concede premium. ${diagnosticoDeCobro(session)}.`,
    );
    return;
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);

  const valores: ListingPremiumUpsert = {
    tenant_id: tenantId,
    listing_id: listingId,
    owner_id: ownerId,
    status: "active",
    // Lo que efectivamente se cobró queda ESCRITO en la fila: la pantalla del
    // dueño muestra ese número y la reconciliación no depende de ir a buscar la
    // Session a Stripe. Sin esto, un aviso pagado a USD 15 mostraría el default
    // de la columna (900).
    price_cents: pactado.cents,
    currency: pactado.currency,
    // Una reactivación empieza limpia: si la fila venía de una cancelación
    // programada, dejar el flag en true mostraría "premium hasta el ..." sobre
    // una suscripción nueva que sí se renueva.
    cancel_at_period_end: false,
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId(session.customer),
    stripe_checkout_session_id: session.id,
    updated_at: new Date().toISOString(),
  };

  // LA CONCESIÓN SE GATEA EN EL `WHERE`, NO EN UN `upsert` A CIEGAS.
  //
  // Antes acá había un `upsert(onConflict: listing_id)` que escribía siempre y
  // seguía de largo hasta la notificación y la auditoría. Como este handler es
  // alcanzable DOS veces por el mismo pago —`checkout.session.completed` y
  // `checkout.session.async_payment_succeeded` son dos `event.id` distintos, y
  // el route reprocesa a propósito cuando `processed=false`—, la segunda pasada
  // mandaba un segundo "tu publicación ya es premium", escribía una segunda fila
  // de auditoría por un solo pago y, en el caso caro, resucitaba a `active` una
  // suscripción cancelada entre medio (con el trigger espejo de 0054 volviendo a
  // subir `listings.tier`). Es el mismo agujero que `activateBoost` ya tenía
  // tapado con `.eq("status","pending_payment")`; acá el predicado es el token
  // del pago, porque en una suscripción `active` es también el estado de partida
  // de una reactivación legítima. Ver `lib/monetization/concesion.ts`.
  //
  // De paso desaparece el reconocimiento del "pago ya usado" por regex sobre el
  // texto del error: los nombres de índice cambian con una migración y esa
  // detección fallaba ABIERTA (un rename convertía un error permanente en tres
  // días de reintentos). Ahora se releen los hechos.
  const concesion = await concederUnaSolaVez(admin, {
    tabla: "listing_premiums",
    columnaSujeto: "listing_id",
    sujeto: listingId,
    columnaPago: "stripe_checkout_session_id",
    pago: session.id,
    valores: valores as unknown as Record<string, unknown>,
  });

  if (concesion.estado === "error") {
    // Un fallo transitorio SÍ lo arregla el reintento de Stripe: se lanza.
    throw new Error(`concesión listing_premiums: ${concesion.codigo}`);
  }
  if (concesion.estado === "pago_ya_usado") {
    // ESA session (o esa suscripción) ya está vinculada a OTRO aviso: un solo
    // pago intentando encender un segundo premium, que es justo lo que los
    // uniques parciales de 0054 existen para frenar. Reintentar no lo arregla
    // —va a seguir vinculada en el reintento número mil— y conceder igual sería
    // el doble premium con un pago. Misma salida que una discrepancia de monto:
    // no conceder, ALERTA con todo lo necesario para reconciliar, y 200.
    console.error(
      `[monetizacion:premium:webhook] ALERTA: la session ${session.id} (aviso ${listingId}, suscripción ${
        subscriptionId ?? "—"
      }) ya está vinculada a OTRO premium — NO se concede, para no dar dos premium con un pago. ${diagnosticoDeCobro(
        session,
      )}. Reconciliar a mano en el Dashboard.`,
    );
    return;
  }
  if (concesion.estado === "duplicado") {
    // No es un error: es "otra entrega del mismo pago llegó primero". El premium
    // ya está concedido; lo único que se evita acá es la segunda notificación y
    // la segunda fila de auditoría.
    console.warn(
      `[monetizacion:premium:webhook] el aviso ${listingId} ya había quedado premium por otra entrega del pago (${session.id}) — no se duplican notificación ni auditoría.`,
    );
    return;
  }

  // `current_period_end` llega en el evento de la suscripción, no acá: la
  // Session no lo trae. El cron no toca filas con NULL, así que la ventana entre
  // los dos eventos no baja nada.

  await createNotification(admin, {
    tenantId,
    profileId: ownerId,
    kind: "listing_premium",
    // "pagos" no se silencia: es el comprobante de algo que la persona compró,
    // no una promoción.
    category: "pagos",
    ignorePrefs: true,
    title: "Tu publicación ya es premium",
    body: "Ya podés subir hasta 20 fotos, un video más largo y agregar tus botones de contacto.",
    href: `/impulsar/${listingId}/botones`,
  });
  // Best-effort SÍ, mudo NO: si la auditoría de una concesión paga se pierde, el
  // rastro de por qué ese aviso es premium desaparece sin dejar señal.
  const { error: auditError } = await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor_id: ownerId,
    action: "listing_premium_activated",
    subject_kind: "listing",
    subject_id: listingId,
    meta: { via: "stripe_checkout" },
  });
  if (auditError) {
    console.error(
      `[monetizacion:premium:webhook] el aviso ${listingId} quedó PREMIUM pero no se pudo auditar — code=${auditError.code}. La concesión es válida; falta el rastro.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Cambios de estado: customer.subscription.*                                 */
/* -------------------------------------------------------------------------- */

/**
 * Sincroniza estado, vencimiento y cancelación programada desde la suscripción.
 *
 * El `.eq('stripe_subscription_id')` es la correlación: NO se confía en la
 * metadata para decidir a qué fila aplicar el cambio. Si nadie matchea, es una
 * suscripción que no es nuestra (o un evento anterior al alta) y no se toca
 * nada, sin throw — reintentar no la va a hacer aparecer.
 *
 * EL CAMINO QUE ROMPE PLATA ES ESTE, no el de alta: si `current_period_end`
 * quedara en NULL, el cron nunca vencería la fila y el aviso se quedaría premium
 * para siempre. Por eso la fecha sale de `periodEndFromSubscription`, que la lee
 * de los ITEMS de la suscripción (ver la advertencia en lib/stripe/subscription).
 */
async function syncFromSubscription(
  admin: AdminClient,
  subscription: Stripe.Subscription,
  forceStatus?: "canceled",
): Promise<void> {
  const status = forceStatus ?? mapStripeSubscriptionStatus(subscription.status);
  const periodEnd = periodEndFromSubscription(subscription);

  const { data: updated, error } = await updatePremiumBySubscription(
    admin,
    subscription.id,
    {
      status,
      // Una suscripción ya cancelada no "va a cancelarse": el flag se apaga para
      // que la pantalla no muestre una fecha futura sobre algo que ya terminó.
      cancel_at_period_end: status === "canceled" ? false : cancelsAtPeriodEnd(subscription),
      ...(periodEnd ? { current_period_end: periodEnd } : {}),
      updated_at: new Date().toISOString(),
    },
  );

  if (error) throw new Error(`update listing_premiums: ${error.code}`);
  if (!updated) {
    console.warn(
      "[monetizacion:premium:webhook] suscripción sin premium asociado — se ignora.",
    );
    return;
  }

  // Sólo se avisa cuando algo CAMBIA para peor. Un cobro exitoso mensual no
  // merece una notificación cada 30 días; que se te apaguen los botones, sí.
  if (status === "canceled" || status === "expired") {
    await createNotification(admin, {
      tenantId: updated.tenant_id,
      profileId: updated.owner_id,
      kind: "listing_premium",
      category: "pagos",
      ignorePrefs: true,
      title: "Tu publicación volvió a ser gratuita",
      body: "Sigue online con hasta 5 fotos y contacto por el chat. Guardamos tus botones: vuelven si te suscribís de nuevo.",
      href: `/negocios/presencia/aviso/${updated.listing_id}`,
      dedupeUnread: true,
    });
  } else if (status === "past_due") {
    await createNotification(admin, {
      tenantId: updated.tenant_id,
      profileId: updated.owner_id,
      kind: "payment_failed",
      category: "pagos",
      ignorePrefs: true,
      title: "No pudimos cobrar tu premium",
      body: `Tu aviso sigue premium mientras lo intentamos de nuevo${
        periodEnd ? `, hasta el ${formatDate(new Date(periodEnd), { style: "long" })}` : ""
      }. Actualizá tu tarjeta para no perder los botones.`,
      href: `/negocios/presencia/aviso/${updated.listing_id}`,
      dedupeUnread: true,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Entrada única                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Procesa un evento de Stripe que corresponde al premium de una publicación.
 *
 * Devuelve `true` si lo manejó (para que el route handler corte ahí) y `false`
 * si el evento no es de este flujo. Lanza sólo ante un error de escritura real:
 * el route handler traduce eso en un 500 y Stripe reintenta.
 */
export async function handleListingPremiumEvent(
  admin: AdminClient,
  event: Stripe.Event,
): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!isListingPremiumEvent(session.metadata)) return false;
      // `completed` con pago async todavía no cobrado espera al
      // async_payment_succeeded — no se concede premium sin plata adentro.
      if (session.payment_status === "paid") {
        await activateFromCheckout(admin, session);
      }
      return true;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      if (!isListingPremiumEvent(subscription.metadata)) return false;
      await syncFromSubscription(admin, subscription);
      return true;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      if (!isListingPremiumEvent(subscription.metadata)) return false;
      // Stripe manda `deleted` tanto por cancelación del dueño como por impago
      // definitivo. Para el aviso el efecto es el mismo: vuelve a gratuito.
      await syncFromSubscription(admin, subscription, "canceled");
      return true;
    }

    default:
      return false;
  }
}
