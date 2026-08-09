import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { metadataString } from "./pactado";

/**
 * =============================================================================
 * RENOVACIONES — `invoice.paid`, el ciclo que se cobra solo
 * =============================================================================
 *
 * Los tres productos por suscripción (Presencia Verificada, Membresía de Tienda,
 * Aviso Premium) se dan de alta por un Checkout —que SÍ se verifica contra el
 * precio pactado— y después se cobran solos, mes a mes, sin que llegue ninguna
 * Session. Hasta acá el estado fluía únicamente por `customer.subscription.*`,
 * que no trae plata: era el único punto de cobro sobre el que la app no miraba
 * absolutamente nada.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTE MÓDULO OBSERVA Y NO DECIDE (leer antes de "endurecerlo")
 *
 * La tentación obvia es replicar acá la verificación del alta: comparar lo
 * cobrado contra `metadata.price_cents` y no renovar si no coincide. SERÍA UN
 * ERROR, y de los caros. Una renovación NO es un alta:
 *
 *  1. EL PRECIO QUE RIGE UNA RENOVACIÓN ES EL DE LA SUSCRIPCIÓN EN STRIPE, no el
 *     de nuestra tabla ni el del día del alta. Entre ciclos el monto cambia por
 *     motivos legítimos: la comunidad edita su precio (`tenant_prices`, 0072) y
 *     migra las suscripciones, se aplica un cupón, cambia el impuesto, hay una
 *     prorrata por un cambio de plan a mitad de mes. Rechazar por "discrepancia"
 *     sería apagarle la tienda a alguien que pagó — y de cara al usuario eso es
 *     peor que el hueco que se quería tapar.
 *  2. NO HAY NADA QUE CONCEDER. En el alta la decisión es binaria (se enciende o
 *     no) y por eso exige prueba. En una renovación el beneficio YA está
 *     encendido; el evento que lo apaga cuando el cobro falla de verdad es
 *     `customer.subscription.updated` (`past_due`) o `.deleted`, que es donde
 *     Stripe pone la decisión después de reintentar. Duplicar esa decisión acá,
 *     con menos información, sólo puede empeorarla.
 *
 * ASÍ QUE ESTE MÓDULO NO ESCRIBE NADA. No toca `status`, ni fechas, ni precios.
 * Hace lo único que en una renovación es verificable y valioso:
 *   (a) CORRELACIONA la factura con una suscripción NUESTRA, y comprueba que el
 *       snapshot de metadata que Stripe le adjunta (tenant/dueño del alta) siga
 *       coincidiendo con la fila. Si no coincide, ALERTA para reconciliar.
 *   (b) REGISTRA el ciclo con una línea diagnosticable: producto, fila, tenant,
 *       dueño, factura y monto cobrado.
 *   (c) AVISA cuando el monto del ciclo se corrió del que quedó escrito en el
 *       alta. Es un aviso, no un rechazo: existe para que un cambio de precio no
 *       pase inadvertido, no para frenar el cobro.
 *
 * POR QUÉ NO SE PERSISTE EL MONTO DEL CICLO EN LA FILA DEL PRODUCTO
 * Porque ya está persistido, mejor, en otro lado: `payment_events` guarda el
 * payload ÍNTEGRO de cada factura, y `admin_revenue_summary` (0074) cuenta los
 * ingresos de suscripción exactamente desde `invoice.paid`. Copiar `amount_paid`
 * a `price_cents` crearía una segunda fuente de verdad, y peor: `amount_paid` NO
 * es el precio recurrente —incluye prorratas e ítems sueltos, y un cupón o un
 * saldo a favor lo dejan en 0—, así que la pantalla del dueño terminaría
 * diciendo "USD 0/mes" después de un crédito. `price_cents` significa "lo que se
 * pactó", y eso no cambia porque una factura haya salido distinta.
 *
 * POR QUÉ SÓLO `invoice.paid` Y NO TAMBIÉN `invoice.payment_succeeded`
 * Son el mismo peso: Stripe emite los dos por el mismo cobro. Atender ambos
 * duplicaría cada línea de registro y cada aviso de cambio de precio. Se eligió
 * `invoice.paid` porque es el que ya usa `app.payment_event_cents` (0074) para
 * contar los ingresos: una sola definición de "el cobro del ciclo" para la app y
 * para el tablero.
 * -----------------------------------------------------------------------------
 */

type AdminClient = ReturnType<typeof createAdminClient>;

/** Lo que necesita saberse de una suscripción nuestra para registrar un ciclo. */
interface FilaRenovable {
  /** Etiqueta del producto, la misma que usa `app.payment_event_product` (0074). */
  producto: string;
  id: string;
  tenantId: string;
  ownerId: string;
  /** Lo pactado en el alta. `null` en Presencia: su tabla no guarda precio. */
  priceCents: number | null;
  currency: string | null;
}

/** Los detalles de la suscripción que generó la factura, o `null`. */
function detallesDeSuscripcion(
  invoice: Stripe.Invoice,
): Stripe.Invoice.Parent.SubscriptionDetails | null {
  // ⚠️ EN LA API DE stripe-node 22 (2025-10-29.clover) LA SUSCRIPCIÓN NO ESTÁ EN
  // LA RAÍZ DE LA FACTURA. `invoice.subscription` —que es lo que enseñan los
  // ejemplos viejos y medio internet— ya no existe: se movió a
  // `parent.subscription_details`. Es la misma trampa que este repo ya pagó una
  // vez con `current_period_end` (ver lib/stripe/subscription.ts).
  return invoice.parent?.subscription_details ?? null;
}

/** El id de la suscripción, venga como string o como objeto expandido. */
function subscriptionId(
  subscription: string | Stripe.Subscription | null | undefined,
): string | null {
  if (typeof subscription === "string") return subscription;
  return subscription?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Buscar la fila: una función por tabla, a propósito                         */
/* -------------------------------------------------------------------------- */

/*
 * Son tres funciones casi iguales y no un bucle sobre un nombre de tabla porque
 * el cliente de Supabase tipa cada tabla por separado: con el nombre en una
 * variable se pierden los tipos de las columnas, que es justamente lo que evita
 * que un rename de columna pase el typecheck.
 */

async function membresiaDeTienda(
  admin: AdminClient,
  subId: string,
): Promise<FilaRenovable | null> {
  const { data, error } = await admin
    .from("store_memberships")
    .select("id, tenant_id, owner_id, price_cents, currency")
    .eq("stripe_subscription_id", subId)
    .maybeSingle();
  if (error) {
    // Un fallo de lectura NO lanza (ver el contrato de `handleInvoicePaidEvent`):
    // deja rastro y el ciclo queda sin registrar. El payload ya está a salvo.
    console.warn(
      `[pagos:renovacion] no se pudo leer store_memberships (${error.code}) — el ciclo de ${subId} queda sin registrar.`,
    );
    return null;
  }
  if (!data) return null;
  return {
    producto: "store_membership",
    id: data.id,
    tenantId: data.tenant_id,
    ownerId: data.owner_id,
    priceCents: data.price_cents,
    currency: data.currency,
  };
}

async function premiumDeAviso(
  admin: AdminClient,
  subId: string,
): Promise<FilaRenovable | null> {
  const { data, error } = await admin
    .from("listing_premiums")
    .select("id, tenant_id, owner_id, price_cents, currency")
    .eq("stripe_subscription_id", subId)
    .maybeSingle();
  if (error) {
    // Un fallo de lectura NO lanza (ver el contrato de `handleInvoicePaidEvent`):
    // deja rastro y el ciclo queda sin registrar. El payload ya está a salvo.
    console.warn(
      `[pagos:renovacion] no se pudo leer listing_premiums (${error.code}) — el ciclo de ${subId} queda sin registrar.`,
    );
    return null;
  }
  if (!data) return null;
  return {
    producto: "listing_premium",
    id: data.id,
    tenantId: data.tenant_id,
    ownerId: data.owner_id,
    priceCents: data.price_cents,
    currency: data.currency,
  };
}

async function presenciaVerificada(
  admin: AdminClient,
  subId: string,
): Promise<FilaRenovable | null> {
  const { data, error } = await admin
    .from("business_accounts")
    .select("id, tenant_id, owner_id")
    .eq("stripe_subscription_id", subId)
    .maybeSingle();
  if (error) {
    // Un fallo de lectura NO lanza (ver el contrato de `handleInvoicePaidEvent`):
    // deja rastro y el ciclo queda sin registrar. El payload ya está a salvo.
    console.warn(
      `[pagos:renovacion] no se pudo leer business_accounts (${error.code}) — el ciclo de ${subId} queda sin registrar.`,
    );
    return null;
  }
  if (!data) return null;
  return {
    // `business_accounts` NO tiene columnas de precio (0008): de Presencia se
    // registra el ciclo y se correlaciona el dueño, pero no hay contra qué
    // comparar el monto. Inventar la comparación contra una constante del código
    // sería repetir el bug que 0072 vino a arreglar.
    producto: "presencia",
    id: data.id,
    tenantId: data.tenant_id,
    ownerId: data.owner_id,
    priceCents: null,
    currency: null,
  };
}

/**
 * A qué tabla ir, según el snapshot de metadata que la factura trae de la
 * suscripción. Es la misma clasificación que hace `app.payment_event_product`
 * (0074) del lado de la base.
 *
 * Sin metadata legible se prueban las tres: una factura de una suscripción vieja
 * (anterior a que las actions escribieran `subscription_data.metadata`) o creada
 * a mano desde el Dashboard igual tiene que poder registrarse.
 */
function dondeBuscar(
  metadata: Stripe.Metadata | null,
): Array<(admin: AdminClient, subId: string) => Promise<FilaRenovable | null>> {
  const kind = metadataString(metadata, "kind");
  if (kind === "store_membership") return [membresiaDeTienda];
  if (kind === "listing_premium") return [premiumDeAviso];
  if (metadataString(metadata, "plan")) return [presenciaVerificada];
  return [membresiaDeTienda, premiumDeAviso, presenciaVerificada];
}

/* -------------------------------------------------------------------------- */
/* Entrada única                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Registra el cobro de un ciclo. Devuelve `true` si el evento es de este flujo
 * (para que el route handler corte ahí) y `false` si no.
 *
 * NUNCA LANZA, ni siquiera si la base falla. Un `throw` acá se traduciría en un
 * 500 y Stripe reintentaría durante tres días una factura QUE YA ESTÁ PAGA —y lo
 * único que se habría perdido con no reintentar es una línea de registro, porque
 * el payload íntegro ya quedó en `payment_events` antes de llegar hasta acá. Un
 * observador no tiene derecho a convertir un cobro exitoso en un error.
 */
export async function handleInvoicePaidEvent(
  admin: AdminClient,
  event: Stripe.Event,
): Promise<boolean> {
  if (event.type !== "invoice.paid") return false;

  const invoice = event.data.object as Stripe.Invoice;
  const detalles = detallesDeSuscripcion(invoice);
  const subId = subscriptionId(detalles?.subscription);

  const cobrado = `cobrado=${invoice.amount_paid ?? "null"} ${invoice.currency ?? "?"}`;

  if (!subId) {
    // Factura suelta (un ítem cargado a mano en el Dashboard, por ejemplo): no
    // es la renovación de ninguno de nuestros tres productos.
    console.warn(
      `[pagos:renovacion] la factura ${invoice.id} no viene de una suscripción — se registra en payment_events y no se hace nada más. ${cobrado}.`,
    );
    return true;
  }

  const metadata = detalles?.metadata ?? null;

  let fila: FilaRenovable | null = null;
  for (const buscar of dondeBuscar(metadata)) {
    fila = await buscar(admin, subId);
    if (fila) break;
  }

  if (!fila) {
    // No es alarma: puede ser una suscripción creada desde el Dashboard, o una
    // factura que llega antes de que el alta escriba la fila.
    console.warn(
      `[pagos:renovacion] la factura ${invoice.id} (suscripción ${subId}) no corresponde a ninguna suscripción nuestra — se ignora. ${cobrado}.`,
    );
    return true;
  }

  // (a) EL SNAPSHOT CONTRA LA FILA. `parent.subscription_details.metadata` es la
  // metadata de la suscripción congelada al finalizarse la factura: la escribió
  // nuestra propia action en el alta y viene firmada por Stripe. Que ya no
  // coincida con la fila significa que la suscripción quedó apuntando a otro
  // dueño o a otra comunidad — no se corrige nada acá (esto no escribe), pero
  // tiene que quedar el rastro para reconciliar a mano.
  const tenantSnapshot = metadataString(metadata, "tenant_id");
  const ownerSnapshot = metadataString(metadata, "owner_id");
  const cruzado =
    (tenantSnapshot && tenantSnapshot !== fila.tenantId) ||
    (ownerSnapshot && ownerSnapshot !== fila.ownerId);
  if (cruzado) {
    console.error(
      `[pagos:renovacion] ALERTA: la factura ${invoice.id} (suscripción ${subId}) dice tenant=${tenantSnapshot} owner=${ownerSnapshot}, pero ${fila.producto} ${fila.id} es de tenant=${fila.tenantId} owner=${fila.ownerId} — NO se toca nada. ${cobrado}. Reconciliar a mano en el Dashboard.`,
    );
  }

  // (b) EL REGISTRO DEL CICLO. Una línea por renovación, sólo con ids: nada de
  // mail del comprador ni datos de facturación, que sí están en el payload y ahí
  // se quedan (`payment_events` tiene SELECT bloqueado por RLS para todo JWT).
  console.info(
    `[pagos:renovacion] ${fila.producto} ${fila.id} · tenant=${fila.tenantId} owner=${fila.ownerId} · factura=${invoice.id} suscripción=${subId} razón=${invoice.billing_reason ?? "?"} · ${cobrado}`,
  );

  // (c) EL AVISO DE CAMBIO DE PRECIO — aviso, no rechazo.
  //
  // Sólo sobre `subscription_cycle`, que es la renovación propiamente dicha. En
  // `subscription_create` (la primera factura) el monto ya lo verificó el alta
  // contra lo pactado, y en `subscription_update` la factura ES una prorrata:
  // avisar ahí sería gritar por un número que TIENE que ser distinto.
  if (invoice.billing_reason !== "subscription_cycle") return true;
  if (fila.priceCents === null || fila.currency === null) return true;

  const monedaCobrada =
    typeof invoice.currency === "string" ? invoice.currency.toLowerCase() : null;
  // La moneda se normaliza de los dos lados antes de compararse: Stripe la manda
  // en minúsculas y `tenant_prices` la guarda en MAYÚSCULAS (0072).
  const monedaFila = fila.currency.toLowerCase();
  const corrido =
    (typeof invoice.amount_paid === "number" && invoice.amount_paid !== fila.priceCents) ||
    (monedaCobrada !== null && monedaCobrada !== monedaFila);

  if (corrido) {
    console.warn(
      `[pagos:renovacion] AVISO: la renovación ${invoice.id} de ${fila.producto} ${fila.id} cobró ${invoice.amount_paid} ${monedaCobrada ?? "?"} y lo pactado en el alta era ${fila.priceCents} ${monedaFila}. NO es un rechazo —el precio que rige una renovación es el de la suscripción en Stripe— pero verificar que el cambio sea intencional.`,
    );
  }

  return true;
}
