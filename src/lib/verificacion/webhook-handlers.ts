import "server-only";

import type Stripe from "stripe";
import { concederUnaSolaVez } from "@/lib/monetization/concesion";
import {
  diagnosticoDeCobro,
  metadataString,
  motivoDeDiscrepancia,
  pactadoFromMetadata,
} from "@/lib/monetization/pactado";
import { createNotification } from "@/lib/notifications/notify";
import {
  mapStripeSubscriptionStatus,
  periodFromInvoice,
  periodEndFromSubscription,
  periodStartFromSubscription,
} from "@/lib/stripe/subscription";
import type { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import { isVerificacionTier, VERIFICACION_BOOST_DIAS } from "./catalogo";
import {
  VERIFICACION_KIND,
  supabaseSinTiparVerificacion,
  type VerificacionStatus,
} from "./types";

/**
 * =============================================================================
 * CHECK AZUL — escritura de estado (service_role)
 * =============================================================================
 *
 * Este módulo es la ÚNICA puerta que escribe `verification_subscriptions` y
 * `verification_boost_grants`. Vive acá y no dentro de
 * `api/webhooks/stripe/route.ts` por el mismo motivo que la membresía de tienda:
 * ese route handler es infraestructura compartida, y así la lógica queda al lado
 * de la action que abre su Checkout, que es donde alguien la va a buscar.
 *
 * -----------------------------------------------------------------------------
 * DÓNDE VA EN EL ORDEN DEL ROUTE HANDLER, Y POR QUÉ NO ES UN DETALLE
 *
 * TIENE QUE CORRER ANTES QUE `handleInvoicePaidEvent`. Ese handler devuelve
 * `true` para TODA factura —incluso para las que no reconoce— y el route corta
 * ahí. Puesto después, este módulo nunca vería un solo `invoice.paid`, que es
 * exactamente el evento del que cuelga el impulso de regalo: la insignia
 * funcionaría y el regalo no llegaría nunca, sin un solo error en los logs.
 *
 * `handleVerificacionEvent` devuelve `false` apenas ve que el `kind` no es el
 * suyo, así que adelantarlo no le cambia el comportamiento a ningún otro
 * producto.
 * -----------------------------------------------------------------------------
 *
 * LA INSIGNIA NO SE ESCRIBE DESDE ACÁ. `profiles.verified_badge` la mantiene
 * `app.mirror_verified_badge()` (trigger de 0101) en la misma transacción en que
 * cambia el `status`. Escribirla también desde la app sería una segunda fuente
 * de verdad para el mismo dato — y la guarda `protect_profile_columns` está
 * justamente para que nadie lo intente por el otro lado.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

function customerId(
  customer: string | { id: string } | null | undefined,
): string | null {
  if (typeof customer === "string") return customer;
  return customer?.id ?? null;
}

/**
 * ¿Este evento es del check azul? El route handler pregunta esto antes de
 * delegar, así los demás flujos de pago no cambian de comportamiento.
 */
export function isVerificacionEvent(
  metadata: Stripe.Metadata | null | undefined,
): boolean {
  return metadataString(metadata, "kind") === VERIFICACION_KIND;
}

/* -------------------------------------------------------------------------- */
/* Alta: checkout.session.completed                                           */
/* -------------------------------------------------------------------------- */

/**
 * Enciende el check azul tras un pago CONFIRMADO.
 *
 * `upsert` sobre `profile_id` (unique en 0101): quien ya tuvo la insignia y la
 * dejó vencer vuelve a `active` en la MISMA fila, sin duplicar historial. Es
 * idempotente por construcción — un reintento de Stripe reescribe los mismos
 * valores y el trigger del espejo no hace nada porque el estado no cambió.
 *
 * CORRELACIÓN OBLIGATORIA (fiscal R3), en este orden:
 *   (a) EL PERFIL existe y es DE ESTE TENANT. Sin esto, una metadata que apunte
 *       al perfil de otra comunidad enciende una insignia cruzada.
 *   (b) LA IDENTIDAD SIGUE CONFIRMADA. Ver abajo — es la regla que hace que la
 *       insignia no sea una mentira.
 *   (c) EL MONTO Y LA MONEDA cobrados son los PACTADOS al abrir la Session
 *       (`metadata.price_cents`/`price_currency`), no lo que diga `tenant_prices`
 *       hoy: si la comunidad edita el precio entre el Checkout y el evento,
 *       releer la tabla acá rechazaría un cobro legítimo (ver
 *       `lib/monetization/pactado.ts`).
 *
 * Discrepancia → log de ALERTA y NO se concede, SIN throw: reintentar no arregla
 * una discrepancia de monto, y el payload ya quedó en `payment_events` para
 * reconciliar.
 */
async function activarDesdeCheckout(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const tenantId = metadataString(session.metadata, "tenant_id");
  const profileId = metadataString(session.metadata, "profile_id");
  const subjectType = metadataString(session.metadata, "subject_type");

  if (!tenantId || !profileId || !isVerificacionTier(subjectType)) {
    console.warn(
      `[verificacion:webhook] la session ${session.id} no trae metadata completa (tenant/profile/subject_type) — NO se concede. ${diagnosticoDeCobro(session)}. Si trae plata adentro, reconciliar a mano en el Dashboard.`,
    );
    return;
  }

  // (a)+(b) EL PERFIL, Y SU IDENTIDAD.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, tenant_id, identity_verified")
    .eq("id", profileId)
    .maybeSingle();
  // Un fallo de LECTURA no es "el perfil no existe": lanza para que el reintento
  // de Stripe lo reprocese. Tragarlo sería no conceder algo ya pagado.
  if (profileError) throw new Error(`select profiles: ${profileError.code}`);
  if (!profile || profile.tenant_id !== tenantId) {
    console.error(
      `[verificacion:webhook] ALERTA: la session ${session.id} pagó por el perfil ${profileId}, que no existe o no es del tenant ${tenantId} (tenant real: ${profile?.tenant_id ?? "—"}) — NO se concede. ${diagnosticoDeCobro(session)}. Revisar refund en el Dashboard.`,
    );
    return;
  }

  // (b) LA IDENTIDAD ES EL REQUISITO, NO UN ADORNO.
  //
  // La action ya lo exige antes de abrir el Checkout, así que por el camino
  // normal esta rama no se pisa nunca. Está igual, y NO concede cuando falla,
  // porque es la única regla que hace que la insignia signifique algo: el check
  // azul se lee como "esta cuenta es quien dice ser", y lo único que respalda esa
  // lectura es Stripe Identity. Encenderlo sin ella sería vender confianza que
  // nadie comprobó — exactamente lo que §11 prohíbe.
  //
  // Sí, esto deja plata cobrada sin servicio entregado durante el rato que tarde
  // la reconciliación. Es el lado correcto en el que equivocarse: un reembolso se
  // devuelve, una insignia falsa la ve toda la comunidad y no se puede desver.
  if (!profile.identity_verified) {
    console.error(
      `[verificacion:webhook] ALERTA: la session ${session.id} pagó el check azul del perfil ${profileId}, que NO tiene la identidad verificada — NO se concede. ${diagnosticoDeCobro(session)}. Devolver el pago en el Dashboard o pedirle que complete Stripe Identity.`,
    );
    return;
  }

  // (c) MONTO Y MONEDA contra lo pactado. Sin precio legible no se concede: 1000
  // ARS y 1000 USD dan el mismo entero y no son el mismo cobro.
  const pactado = pactadoFromMetadata(session.metadata);
  if (!pactado) {
    console.error(
      `[verificacion:webhook] ALERTA: la session ${session.id} (perfil ${profileId}) no trae un precio pactado legible en metadata — NO se concede. ${diagnosticoDeCobro(session)}. Reconciliar a mano en el Dashboard.`,
    );
    return;
  }
  const discrepancia = motivoDeDiscrepancia(session, pactado);
  if (discrepancia) {
    console.error(
      `[verificacion:webhook] ALERTA: la session ${session.id} (perfil ${profileId}) ${discrepancia} — NO se concede. ${diagnosticoDeCobro(session)}.`,
    );
    return;
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);

  // LA CONCESIÓN SE GATEA EN EL `WHERE`, NO EN UN `upsert` A CIEGAS.
  //
  // Este handler es alcanzable DOS veces por el mismo pago (`completed` y
  // `async_payment_succeeded` traen la misma Session con `event.id` distintos, y
  // el route reprocesa a propósito cuando `processed=false`). El `upsert` que
  // había acá escribía siempre y seguía de largo hasta la notificación y la
  // auditoría — y encima reescribía `started_at` con el reloj de CADA pasada y
  // limpiaba `canceled_at`, así que una entrega demorada corría la fecha de alta
  // hacia adelante y borraba una baja que ya había ocurrido.
  //
  // El token es la SUSCRIPCIÓN: esta tabla no tiene columna de checkout session
  // (0101), y sirve igual porque cada Checkout de alta crea una suscripción
  // nueva — una reactivación legítima trae otro id y sí matchea. Ver
  // `lib/monetization/concesion.ts`.
  if (!subscriptionId) {
    console.warn(
      `[verificacion:webhook] la session ${session.id} (perfil ${profileId}) no trae suscripción — se concede sin poder detectar una re-entrega.`,
    );
  }
  const concesion = await concederUnaSolaVez(supabaseSinTiparVerificacion(admin), {
    tabla: "verification_subscriptions",
    columnaSujeto: "profile_id",
    sujeto: profileId,
    columnaPago: "stripe_subscription_id",
    pago: subscriptionId,
    valores: {
        tenant_id: tenantId,
        profile_id: profileId,
        subject_type: subjectType,
        status: "active",
        price_cents: pactado.cents,
        // ⚠️ EN MAYÚSCULAS, y no `pactado.currency` a secas.
        //
        // `pactadoFromMetadata` normaliza a MINÚSCULAS a propósito: su trabajo es
        // comparar contra `session.currency`, que Stripe manda así. Pero esta
        // columna guarda un PRECIO PACTADO, hermano de `tenant_prices.currency`,
        // que es ISO 4217 canónico y tiene `check (currency ~ '^[A-Z]{3}$')`.
        //
        // Escribir "usd" acá no era un detalle cosmético: violaba el CHECK, el
        // upsert lanzaba, el handler devolvía 500 y Stripe reintentaba tres días
        // el mismo evento condenado. Resultado: cobrado y sin insignia, para
        // TODAS las altas. Lo encontró el test "el camino feliz escribe UNA fila
        // activa con lo pactado" antes de que existiera una sola clave de Stripe.
        currency: pactado.currency.toUpperCase(),
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId(session.customer),
        started_at: new Date().toISOString(),
        // `canceled_at` se limpia a propósito: una reactivación en la misma fila
        // que conservara la fecha de baja anterior diría que está cancelada
        // justo cuando acaba de volver.
        canceled_at: null,
        updated_at: new Date().toISOString(),
    },
  });

  if (concesion.estado === "error") {
    // Un fallo transitorio SÍ lo arregla el reintento de Stripe: se lanza.
    throw new Error(`concesión verification_subscriptions: ${concesion.codigo}`);
  }
  if (concesion.estado === "pago_ya_usado") {
    // ESA suscripción ya está en la fila de OTRO perfil
    // (`verification_subscriptions_stripe_sub_uniq`, 0101): un solo pago
    // intentando encender dos insignias.
    //
    // ANTES ESTO ERA UN `throw` PELADO, y este archivo ya documenta lo que eso
    // cuesta: un CHECK violado hizo que el upsert lanzara, el handler devolviera
    // 500 y Stripe reintentara tres días el mismo evento condenado — cobrado y
    // sin insignia, para TODAS las altas. El error cambió; la forma de fallar
    // era la misma. No conceder, ALERTA para reconciliar, y 200.
    console.error(
      `[verificacion:webhook] ALERTA: la session ${session.id} (perfil ${profileId}, suscripción ${
        subscriptionId ?? "—"
      }) ya está vinculada a OTRA verificación — NO se concede, para no dar dos insignias con un pago. ${diagnosticoDeCobro(
        session,
      )}. Reconciliar a mano en el Dashboard.`,
    );
    return;
  }
  if (concesion.estado === "duplicado") {
    // No es un error: otra entrega del mismo pago llegó primero. La insignia ya
    // está concedida; lo único que se evita es el segundo comprobante.
    console.warn(
      `[verificacion:webhook] el perfil ${profileId} ya había quedado verificado por otra entrega del pago (${session.id}) — no se duplican notificación ni auditoría.`,
    );
    return;
  }

  // El período (y con él, el primer impulso de regalo) llega en `invoice.paid`,
  // que Stripe emite junto con el alta. La Session no trae fechas de ciclo, y el
  // cron de red no toca filas sin período — así que la ventana entre los dos
  // eventos no regala ni deja de regalar nada.

  await createNotification(admin, {
    tenantId,
    profileId,
    kind: "verificacion",
    // "pagos" es una de las tres que no se silencian: es el comprobante de algo
    // que la persona compró, no una promoción.
    category: "pagos",
    ignorePrefs: true,
    title: "Tu check azul ya está activo",
    body: "Ya se ve al lado de tu nombre en toda la comunidad. Tu impulso de regalo de este mes te está esperando.",
    href: "/verificacion",
  });
  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor_id: profileId,
    action: "verification_activated",
    subject_kind: "profile",
    subject_id: profileId,
    meta: { via: "stripe_checkout", subject_type: subjectType },
  });
}

/* -------------------------------------------------------------------------- */
/* Cambios de estado: customer.subscription.*                                 */
/* -------------------------------------------------------------------------- */

/**
 * Sincroniza estado y período desde la suscripción.
 *
 * El `.eq('stripe_subscription_id')` es la correlación: NO se confía en la
 * metadata para decidir a qué fila aplicar el cambio. Es la misma disciplina de
 * la membresía de tienda y del premium de un aviso — la metadata de una
 * suscripción es editable desde el Dashboard de Stripe, el id no.
 *
 * Y por lo mismo NO SE TOCA `subject_type` NI `price_cents`: el escalón lo
 * concede el ALTA, contra un cobro verificado. Si la metadata dijera
 * `subject_type: 'profesional'` en una fila que pagó 'persona', escribirlo acá
 * sería un ascenso de USD 6.99 a USD 19.99 sin cobrar la diferencia. Esta rama
 * mueve ESTADO, no nivel. Un cambio de escalón abre un Checkout nuevo.
 */
async function sincronizarDesdeSuscripcion(
  admin: AdminClient,
  subscription: Stripe.Subscription,
  forceStatus?: "canceled",
): Promise<void> {
  const status: VerificacionStatus =
    forceStatus ?? mapStripeSubscriptionStatus(subscription.status);
  const periodStart = periodStartFromSubscription(subscription);
  const periodEnd = periodEndFromSubscription(subscription);

  const { data: updated, error } = await supabaseSinTiparVerificacion(admin)
    .from("verification_subscriptions")
    .update({
      status,
      ...(periodStart ? { current_period_start: periodStart } : {}),
      ...(periodEnd ? { current_period_end: periodEnd } : {}),
      ...(status === "canceled" ? { canceled_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id)
    .select("id, tenant_id, profile_id")
    .maybeSingle();

  if (error) throw new Error(`update verification_subscriptions: ${error.code}`);
  if (!updated) {
    console.warn(
      `[verificacion:webhook] la suscripción ${subscription.id} no tiene fila asociada — se ignora.`,
    );
    return;
  }

  const fila = updated as { id: string; tenant_id: string; profile_id: string };

  // Sólo se avisa cuando la insignia se APAGA o está en riesgo. Un cobro mensual
  // exitoso no merece una notificación cada 30 días.
  if (status === "canceled" || status === "expired") {
    await createNotification(admin, {
      tenantId: fila.tenant_id,
      profileId: fila.profile_id,
      kind: "verificacion",
      category: "pagos",
      ignorePrefs: true,
      title: "Tu check azul se apagó",
      body: "Se terminó tu suscripción, así que la insignia ya no aparece al lado de tu nombre. Tu identidad verificada sigue igual: eso es gratis y no se pierde.",
      href: "/verificacion",
      dedupeUnread: true,
    });
  } else if (status === "past_due") {
    await createNotification(admin, {
      tenantId: fila.tenant_id,
      profileId: fila.profile_id,
      kind: "payment_failed",
      category: "pagos",
      ignorePrefs: true,
      title: "No pudimos cobrar tu check azul",
      body: `Mientras tanto la insignia queda en pausa${
        periodEnd ? `, y reintentamos hasta el ${formatDate(new Date(periodEnd), { style: "long" })}` : ""
      }. Actualizá tu tarjeta y vuelve sola.`,
      href: "/verificacion",
      dedupeUnread: true,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* El regalo mensual: invoice.paid                                            */
/* -------------------------------------------------------------------------- */

/**
 * Otorga el crédito de impulso del período que se acaba de cobrar.
 *
 * POR QUÉ CUELGA DE `invoice.paid` Y NO DE UN CRON QUE MIRE EL CALENDARIO
 *   Porque `invoice.paid` ES el hecho «pagó el mes», que es exactamente la
 *   condición que puso el cliente («cuando pagan por el check azul, se le da al
 *   comienzo del mes…»). Un cron tendría que reimplementar el calendario de
 *   facturación de Stripe —prorratas, cupones, cambios de ciclo, reintentos— y
 *   cada diferencia entre esa copia y la realidad sería un regalo entregado a
 *   quien no pagó, o no entregado a quien sí. Además `invoice.paid` llega
 *   también en el ALTA, así que el primer regalo no necesita un camino aparte.
 *   El cron de 0101 existe igual, pero SÓLO como red (ver abajo).
 *
 * LA IDEMPOTENCIA NO LA HACE ESTE CÓDIGO, LA HACE EL ÍNDICE
 *   `unique (subscription_id, period_start)`. No se pregunta "¿ya se lo di?" —
 *   preguntar y después insertar es una carrera que dos webhooks simultáneos
 *   pierden. Se inserta, y si choca, el crédito ya estaba. Por eso el 23505 se
 *   trata como éxito y no como error: es el resultado ESPERADO de un reintento.
 *
 * EL PERÍODO SALE DE LAS LÍNEAS DE LA FACTURA, no de `invoice.period_start` (ver
 * `periodFromInvoice`): los campos de la raíz describen cuándo se crearon los
 * ítems y pueden repetir la misma fecha entre ciclos, lo que haría que el
 * segundo mes pago chocara contra el UNIQUE del primero y se quedara sin regalo.
 */
async function otorgarRegalo(
  admin: AdminClient,
  invoice: Stripe.Invoice,
  subscriptionId: string,
): Promise<void> {
  const cliente = supabaseSinTiparVerificacion(admin);

  const { data, error: selectError } = await cliente
    .from("verification_subscriptions")
    .select("id, tenant_id, profile_id, status")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (selectError) throw new Error(`select verification_subscriptions: ${selectError.code}`);
  if (!data) {
    console.warn(
      `[verificacion:webhook] la factura ${invoice.id} (suscripción ${subscriptionId}) no corresponde a ninguna verificación nuestra — se ignora.`,
    );
    return;
  }
  const fila = data as {
    id: string;
    tenant_id: string;
    profile_id: string;
    status: VerificacionStatus;
  };

  // EL ESTADO SE MIRA, NO SÓLO SE LEE.
  //
  // `status` venía en el `select` y en el tipo de `fila` desde el día uno, y no
  // se consultaba en ninguna parte: una columna de estado que se trae y nunca se
  // chequea es un gate que alguien pensó y se perdió en el camino. Consecuencia
  // concreta: un `invoice.paid` demorado (o el de la última factura de un ciclo
  // que se cancela) le regalaba un impulso —un beneficio REAL y canjeable, que
  // 0101 convierte en una fila de `boosts`— a una suscripción ya cancelada o
  // vencida. El regalo es del mes que se está pagando; si la insignia no está
  // activa, no hay mes que regalar.
  if (fila.status !== "active") {
    console.warn(
      `[verificacion:webhook] la factura ${invoice.id} (suscripción ${subscriptionId}) llegó con la verificación en "${fila.status}" — no se otorga el impulso de regalo.`,
    );
    return;
  }

  const periodo = periodFromInvoice(invoice);
  if (!periodo) {
    // Sin período legible no se inventa uno: una fecha adivinada acá es un
    // regalo de más o de menos. El cron de red lo levanta cuando
    // `customer.subscription.updated` escriba el ciclo en la fila.
    console.warn(
      `[verificacion:webhook] la factura ${invoice.id} no trae un período de servicio legible en sus líneas — el impulso de regalo queda para el job de red (backfill-verification-boost-grants).`,
    );
    return;
  }

  // El ciclo, en la fila. Lo escribe también `customer.subscription.updated`,
  // pero el orden de llegada de los dos eventos no está garantizado y el cron de
  // red necesita estas dos fechas para poder actuar.
  //
  // EL CICLO SÓLO AVANZA, NUNCA RETROCEDE — y el predicado va en el `WHERE`.
  // Stripe no garantiza el orden de entrega: la factura del mes 1 puede llegar
  // DESPUÉS de la del mes 2 (reintento tras un 500, o dos entregas cruzadas). Sin
  // esta condición, esa factura vieja pisaba `current_period_end` con una fecha
  // ya pasada, y esa columna es justo la que lee el cron de expiración de 0101:
  // una insignia PAGA se apagaba sola por un evento fuera de orden. `is.null`
  // cubre el alta, donde todavía no hay ciclo escrito.
  const { error: updateError } = await cliente
    .from("verification_subscriptions")
    .update({
      current_period_start: periodo.start,
      current_period_end: periodo.end,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fila.id)
    .or(`current_period_end.is.null,current_period_end.lt.${periodo.end}`);
  if (updateError) throw new Error(`update verification_subscriptions: ${updateError.code}`);

  const { error: insertError } = await cliente
    .from("verification_boost_grants")
    .insert({
      tenant_id: fila.tenant_id,
      subscription_id: fila.id,
      profile_id: fila.profile_id,
      period_start: periodo.start,
      duration_days: VERIFICACION_BOOST_DIAS,
      expires_at: periodo.end,
    });

  if (insertError) {
    // 23505 = el UNIQUE hizo su trabajo. Es el camino NORMAL de un reintento de
    // Stripe o de una carrera con el cron de red, no una anomalía: se sale en
    // silencio y sin notificar de nuevo.
    if (insertError.code === "23505") return;
    throw new Error(`insert verification_boost_grants: ${insertError.code}`);
  }

  await createNotification(admin, {
    tenantId: fila.tenant_id,
    profileId: fila.profile_id,
    kind: "verificacion",
    category: "pagos",
    ignorePrefs: true,
    title: `Tenés ${VERIFICACION_BOOST_DIAS} días de impulso de regalo`,
    body: `Viene con tu check azul. Elegí a qué aviso se lo querés dar antes del ${formatDate(new Date(periodo.end), { style: "long" })} — después de esa fecha se pierde.`,
    href: "/verificacion",
    dedupeUnread: true,
  });
}

/* -------------------------------------------------------------------------- */
/* Entrada única                                                              */
/* -------------------------------------------------------------------------- */

/** El id de la suscripción de una factura, venga como string o expandido. */
function subscriptionIdDeFactura(invoice: Stripe.Invoice): string | null {
  // ⚠️ `invoice.subscription` YA NO EXISTE en la API de stripe-node 22: se movió
  // a `parent.subscription_details`. Misma trampa que `current_period_end`.
  const detalles = invoice.parent?.subscription_details ?? null;
  const subscription = detalles?.subscription;
  if (typeof subscription === "string") return subscription;
  return subscription?.id ?? null;
}

/**
 * Procesa un evento de Stripe que corresponde al check azul.
 *
 * Devuelve `true` si lo manejó (para que el route handler corte ahí) y `false`
 * si el evento no es de este flujo. Lanza sólo ante un error de escritura real:
 * el route handler traduce eso en un 500 y Stripe reintenta.
 *
 * ⚠️ VA ANTES QUE `handleInvoicePaidEvent` EN EL ROUTE (ver la cabecera).
 */
export async function handleVerificacionEvent(
  admin: AdminClient,
  event: Stripe.Event,
): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!isVerificacionEvent(session.metadata)) return false;
      // `completed` con pago async todavía no cobrado espera al
      // async_payment_succeeded — no se enciende una insignia sin plata adentro.
      if (session.payment_status === "paid") {
        await activarDesdeCheckout(admin, session);
      } else {
        console.warn(
          `[verificacion:webhook] la session ${session.id} llegó con payment_status="${session.payment_status}" — NO se concede todavía; se espera checkout.session.async_payment_succeeded.`,
        );
      }
      return true;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      if (!isVerificacionEvent(subscription.metadata)) return false;
      await sincronizarDesdeSuscripcion(admin, subscription);
      return true;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      if (!isVerificacionEvent(subscription.metadata)) return false;
      // Stripe manda `deleted` tanto por cancelación de la persona como por
      // impago definitivo. Para la insignia el efecto es el mismo: se apaga.
      await sincronizarDesdeSuscripcion(admin, subscription, "canceled");
      return true;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const metadata = invoice.parent?.subscription_details?.metadata ?? null;
      if (!isVerificacionEvent(metadata)) return false;
      const subscriptionId = subscriptionIdDeFactura(invoice);
      if (!subscriptionId) {
        console.warn(
          `[verificacion:webhook] la factura ${invoice.id} dice ser de verificación pero no trae suscripción — se ignora.`,
        );
        return true;
      }
      await otorgarRegalo(admin, invoice, subscriptionId);
      return true;
    }

    default:
      return false;
  }
}
