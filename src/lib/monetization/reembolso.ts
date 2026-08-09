import "server-only";

import type Stripe from "stripe";
import { createNotification } from "@/lib/notifications/notify";
import { getStripe } from "@/lib/stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { metadataString } from "./pactado";

/**
 * =============================================================================
 * REEMBOLSOS Y DISPUTAS — `charge.refunded` y `charge.dispute.created`
 * =============================================================================
 *
 * Los cinco productos tenían camino de ENCENDIDO verificado y ningún camino de
 * APAGADO por devolución: se reembolsaba la plata en el Dashboard y la tienda,
 * el impulso o la presencia seguían activos. El tablero de ingresos (0074) sí
 * descontaba el reembolso, así que la contabilidad y el producto decían cosas
 * distintas.
 *
 * -----------------------------------------------------------------------------
 * QUÉ APAGA CADA CASO, Y POR QUÉ NO SON TODOS IGUALES
 *
 * La asimetría de riesgo de este archivo es la INVERSA de la del alta. Allá lo
 * caro era conceder sin cobrar; acá lo caro es APAGARLE EL SERVICIO A ALGUIEN
 * QUE PAGÓ. Por eso se revoca en un solo caso, el único inequívoco, y todo lo
 * demás alerta.
 *
 * 1. REEMBOLSO TOTAL DE UN PAGO ÚNICO (impulso, campaña de post) → REVOCA.
 *    Se devolvió el 100% de un producto que se compró una vez y de una: no queda
 *    nada comprado. El beneficio se apaga en el acto (`status='canceled'`,
 *    `ends_at=now()`), se avisa a quien compró y queda el rastro en `audit_log`.
 *
 * 2. REEMBOLSO PARCIAL DE UN PAGO ÚNICO → NO REVOCA, AVISA.
 *    Un parcial es casi siempre un gesto comercial ("te devuelvo el 30% porque
 *    el impulso rindió mal") sobre un servicio que la persona sigue queriendo.
 *    Apagar los 14 días restantes por haber devuelto 3 sería cobrar el enojo dos
 *    veces. No existe además ningún criterio no arbitrario para decidir a partir
 *    de qué porcentaje se apaga: cualquier umbral que inventáramos acá sería una
 *    política de negocio disfrazada de código.
 *
 * 3. REEMBOLSO (TOTAL O PARCIAL) DE UNA SUSCRIPCIÓN → NO REVOCA, ALERTA.
 *    Tres motivos, en orden de peso:
 *      a. NO ES UNA BAJA. Devolver la factura del mes en curso es lo que se hace
 *         cuando alguien se queja de un mes malo Y SIGUE SIENDO CLIENTE. La baja
 *         de verdad llega por `customer.subscription.deleted`, y el impago real
 *         por `.updated` (`past_due`/`unpaid`) — que es donde Stripe pone la
 *         decisión DESPUÉS de reintentar. Duplicar esa decisión acá sólo puede
 *         empeorarla, porque acá hay menos información: el evento no dice si la
 *         suscripción sigue viva.
 *      b. NO SE SABE QUÉ CICLO SE DEVOLVIÓ. Un reembolso de la factura de hace
 *         tres meses llega con la misma forma que el de la de ayer. Apagar la
 *         tienda de hoy por un ciclo viejo ya reembolsado y ya consumido sería
 *         un error puro.
 *      c. YA HAY UN OBSERVADOR CON ESTE MISMO CRITERIO. `renovacion.ts` decidió
 *         exactamente lo mismo para `invoice.paid` y por las mismas razones:
 *         registrar y avisar, nunca decidir. Este archivo es su contracara.
 *
 * 4. DISPUTA (`charge.dispute.created`) → NO REVOCA, ALERTA FUERTE.
 *    Una disputa NO es una resolución: la plata está RETENIDA, no perdida, y el
 *    comercio la puede ganar (`dispute.status='won'`). Es además reversible por
 *    quien la abrió: el caso típico de "no reconozco este cargo" termina en
 *    disputa retirada.
 *    LO QUE DECIDE ES LA PUERTA DE VUELTA: revocar en `dispute.created` sería
 *    una puerta de una sola dirección, porque NO atendemos `dispute.closed` — si
 *    el comercio gana, nada volvería a encender lo apagado, y quedaría un
 *    cliente pagador con el servicio muerto y sin forma automática de
 *    recuperarlo. Entre "el 1% que estafa disfruta el servicio unas semanas más"
 *    y "el que gana su disputa se queda sin nada para siempre", el segundo error
 *    es peor y es el irreversible.
 *    MARCAR TAMPOCO SE PUEDE HOY: no hay columna donde anotar "en disputa" sin
 *    tocar el schema, y este trabajo no toca migraciones. La forma exacta de la
 *    columna que haría falta está reportada en la entrega; hasta entonces, la
 *    marca es el log + el payload íntegro en `payment_events`.
 *
 * -----------------------------------------------------------------------------
 * CÓMO SE CORRELACIONA UN COBRO DEVUELTO CON NUESTRA FILA
 *
 * Un `Charge` sólo conoce su `payment_intent`; nuestras dos tablas one-time
 * guardan `stripe_checkout_session_id` y no el PaymentIntent. El puente es
 * `checkout.sessions.list({ payment_intent })`, que es la forma documentada de
 * ir de un cobro a su Session, MÁS la misma exigencia que usa la activación: la
 * Session que devuelve Stripe tiene que ser EXACTAMENTE la vinculada a la fila.
 * La metadata sola no alcanza acá tampoco.
 *
 * ES UNA LLAMADA SALIENTE DENTRO DEL WEBHOOK, y el objetivo de este endpoint es
 * responder 2xx rápido (ARQUITECTURA §9). Se acepta a sabiendas: los reembolsos
 * y las disputas son órdenes de magnitud más raros que los pagos, y la
 * alternativa —guardar el PaymentIntent en `boosts`/`post_promotions`— es un
 * cambio de schema que este trabajo no puede hacer. Está reportado con su forma
 * exacta; el día que exista la columna, esta llamada desaparece.
 *
 * ⚠️ `charge.invoice` YA NO EXISTE en stripe-node 22 (API 2025-10-29.clover), así
 * que NO se puede preguntar "¿este cobro es de una factura?" para separar
 * suscripción de pago único. Es la misma trampa que este repo ya pagó dos veces
 * (`current_period_end` en lib/stripe/subscription.ts, `invoice.subscription` en
 * renovacion.ts). La separación se hace al revés y sin adivinar: si el cobro
 * mapea a una Session nuestra con `boost_id`/`post_promotion_id`, es pago único;
 * si no mapea, no se toca nada.
 *
 * -----------------------------------------------------------------------------
 * IDEMPOTENCIA Y ERRORES
 *
 * - `payment_events.event_id` es UNIQUE: un `charge.refunded` reentregado ni
 *   siquiera llega hasta acá si el anterior cerró bien.
 * - Si llega igual (el intento anterior murió a mitad), la revocación es
 *   idempotente por estado: sólo se escribe sobre una fila `active`, y el UPDATE
 *   lleva `.eq('status','active')` para que dos entregas simultáneas no puedan
 *   pisarse. Una fila ya `canceled` no vuelve a notificar ni a auditar.
 * - NUNCA SE LANZA salvo por el fallo de la escritura de revocación, que sí es
 *   transitorio y sí se arregla reintentando. Todo lo demás (Stripe no
 *   responde, la fila no aparece, la lectura falla) alerta y devuelve: un throw
 *   acá pondría a Stripe reintentando tres días un evento que no va a poder
 *   aplicarse, y el payload ya está a salvo en `payment_events`.
 * -----------------------------------------------------------------------------
 */

type AdminClient = ReturnType<typeof createAdminClient>;

/** Un id de Stripe que puede venir crudo o como objeto expandido. */
function idDe(valor: string | { id: string } | null | undefined): string | null {
  if (typeof valor === "string") return valor;
  return valor?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Localizar la compra única detrás de un cobro                               */
/* -------------------------------------------------------------------------- */

/**
 * La compra one-time que originó un cobro, ya correlacionada contra su fila.
 *
 * Es una unión discriminada y no `{ tabla: string }` porque el cliente de
 * Supabase tipa cada tabla por separado: con el nombre de la tabla en una
 * variable se pierden los tipos de las columnas, que es justo lo que evita que
 * un rename pase el typecheck. Mismo motivo por el que `renovacion.ts` tiene una
 * función por tabla en vez de un bucle.
 */
type CompraUnica =
  | {
      producto: "boost";
      row: {
        id: string;
        tenant_id: string;
        listing_id: string;
        buyer_id: string;
        status: string;
      };
    }
  | {
      producto: "post_promotion";
      row: {
        id: string;
        tenant_id: string;
        post_id: string;
        buyer_id: string;
        status: string;
      };
    };

/**
 * La Checkout Session que originó un cobro, o `null`.
 *
 * Traga cualquier fallo de red o de API: no poder preguntarle a Stripe NO puede
 * terminar en un 500 (Stripe reintentaría tres días) ni, mucho menos, en una
 * revocación a ciegas. Sin Session no se revoca nada.
 */
async function sessionDelCobro(
  paymentIntentId: string,
): Promise<Stripe.Checkout.Session | null> {
  try {
    const { data } = await getStripe().checkout.sessions.list({
      payment_intent: paymentIntentId,
      limit: 1,
    });
    return data[0] ?? null;
  } catch (error) {
    console.warn(
      `[pagos:reembolso] no se pudo buscar la Checkout Session de ${paymentIntentId} en Stripe (${
        error instanceof Error ? error.message : "error desconocido"
      }) — NO se revoca nada; reconciliar a mano en el Dashboard.`,
    );
    return null;
  }
}

/** El impulso de la Session, exigiendo que la Session sea la vinculada a la fila. */
async function boostDeLaSession(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
): Promise<CompraUnica | null> {
  const boostId = metadataString(session.metadata, "boost_id");
  if (!boostId) return null;

  const { data, error } = await admin
    .from("boosts")
    .select("id, tenant_id, listing_id, buyer_id, status, stripe_checkout_session_id")
    .eq("id", boostId)
    .maybeSingle();
  if (error) {
    console.warn(
      `[pagos:reembolso] no se pudo leer boosts (${error.code}) — el reembolso de ${session.id} queda sin aplicar.`,
    );
    return null;
  }
  if (!data) return null;

  // MISMA EXIGENCIA QUE LA ACTIVACIÓN: la Session del cobro tiene que ser la que
  // quedó vinculada al crear el checkout. Sin esto, una metadata que apunte a
  // otro impulso apagaría un impulso ajeno con un reembolso propio.
  if (data.stripe_checkout_session_id !== session.id) {
    console.error(
      `[pagos:reembolso] ALERTA: la session ${session.id} dice ser del impulso ${boostId}, pero ese impulso está vinculado a ${
        data.stripe_checkout_session_id ?? "ninguna"
      } — NO se revoca. Reconciliar a mano en el Dashboard.`,
    );
    return null;
  }
  return { producto: "boost", row: data };
}

/** La campaña de post de la Session, con la misma exigencia de vínculo. */
async function campanaDeLaSession(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
): Promise<CompraUnica | null> {
  const promoId = metadataString(session.metadata, "post_promotion_id");
  if (!promoId) return null;

  const { data, error } = await admin
    .from("post_promotions")
    .select("id, tenant_id, post_id, buyer_id, status, stripe_checkout_session_id")
    .eq("id", promoId)
    .maybeSingle();
  if (error) {
    console.warn(
      `[pagos:reembolso] no se pudo leer post_promotions (${error.code}) — el reembolso de ${session.id} queda sin aplicar.`,
    );
    return null;
  }
  if (!data) return null;

  if (data.stripe_checkout_session_id !== session.id) {
    console.error(
      `[pagos:reembolso] ALERTA: la session ${session.id} dice ser de la campaña ${promoId}, pero esa campaña está vinculada a ${
        data.stripe_checkout_session_id ?? "ninguna"
      } — NO se revoca. Reconciliar a mano en el Dashboard.`,
    );
    return null;
  }
  return { producto: "post_promotion", row: data };
}

/** La compra one-time detrás de un PaymentIntent, o `null` si no es de las nuestras. */
async function compraUnicaDelPago(
  admin: AdminClient,
  paymentIntentId: string,
): Promise<CompraUnica | null> {
  const session = await sessionDelCobro(paymentIntentId);
  if (!session) return null;
  return (
    (await boostDeLaSession(admin, session)) ?? (await campanaDeLaSession(admin, session))
  );
}

/* -------------------------------------------------------------------------- */
/* Qué producto por suscripción toca un cobro que no es one-time              */
/* -------------------------------------------------------------------------- */

/**
 * Los productos por suscripción vinculados a un customer, sólo para el LOG.
 *
 * No decide nada: existe para que la alerta diga "esto toca la membresía de
 * tienda X del tenant Y" en vez de "hubo un reembolso de algo". La diferencia
 * entre una alerta accionable y una inútil es exactamente esa línea.
 *
 * Un customer puede tener varios productos a la vez (una tienda y dos avisos
 * premium), así que se listan todos y nunca se usa `maybeSingle`, que sería un
 * error con más de una fila.
 */
async function productosDelCustomer(
  admin: AdminClient,
  customerId: string | null,
): Promise<string[]> {
  if (!customerId) return [];
  const encontrados: string[] = [];

  const { data: tiendas } = await admin
    .from("store_memberships")
    .select("id, tenant_id, owner_id, status")
    .eq("stripe_customer_id", customerId);
  for (const t of tiendas ?? []) {
    encontrados.push(`store_membership ${t.id} (tenant=${t.tenant_id} owner=${t.owner_id} status=${t.status})`);
  }

  const { data: premiums } = await admin
    .from("listing_premiums")
    .select("id, tenant_id, owner_id, status")
    .eq("stripe_customer_id", customerId);
  for (const p of premiums ?? []) {
    encontrados.push(`listing_premium ${p.id} (tenant=${p.tenant_id} owner=${p.owner_id} status=${p.status})`);
  }

  const { data: cuentas } = await admin
    .from("business_accounts")
    .select("id, tenant_id, owner_id, plan_status")
    .eq("stripe_customer_id", customerId);
  for (const c of cuentas ?? []) {
    encontrados.push(`presencia ${c.id} (tenant=${c.tenant_id} owner=${c.owner_id} status=${c.plan_status})`);
  }

  return encontrados;
}

/* -------------------------------------------------------------------------- */
/* Revocación — el único caso que escribe                                     */
/* -------------------------------------------------------------------------- */

/**
 * Apaga un impulso reembolsado por completo.
 *
 * `status='canceled'` y no `'expired'`: la compra se DESHIZO, no se consumió. El
 * `ends_at=now()` es contabilidad honesta —el impulso terminó hoy— y además deja
 * la fila consistente para cualquier lectura que mire la ventana en vez del
 * estado. El `.eq('status','active')` es la idempotencia a nivel base: dos
 * entregas del mismo evento no pueden escribir dos veces.
 */
async function revocarBoost(
  admin: AdminClient,
  row: Extract<CompraUnica, { producto: "boost" }>["row"],
  chargeId: string,
): Promise<void> {
  const ahora = new Date().toISOString();
  const { error } = await admin
    .from("boosts")
    .update({ status: "canceled", ends_at: ahora })
    .eq("id", row.id)
    .eq("status", "active");
  // Un fallo de escritura acá SÍ es transitorio y SÍ se arregla reintentando:
  // se lanza para que el route devuelva 500 y Stripe reentregue el evento.
  if (error) throw new Error(`update boosts: ${error.code}`);

  console.info(
    `[pagos:reembolso] impulso ${row.id} (tenant=${row.tenant_id} owner=${row.buyer_id}) revocado por reembolso total del cobro ${chargeId}.`,
  );

  // Notificación + auditoría: best-effort, jamás rompen la revocación.
  await createNotification(admin, {
    tenantId: row.tenant_id,
    profileId: row.buyer_id,
    kind: "boost",
    // "pagos" no se silencia: es el comprobante de un movimiento de plata de la
    // persona, no una promoción.
    category: "pagos",
    ignorePrefs: true,
    title: "Te devolvimos el pago de tu impulso",
    body: "Tu aviso dejó de aparecer como Destacado. Sigue publicado como siempre, y podés impulsarlo de nuevo cuando quieras.",
    href: `/impulsar/${row.listing_id}`,
    dedupeUnread: true,
  });
  await admin.from("audit_log").insert({
    tenant_id: row.tenant_id,
    actor_id: row.buyer_id,
    action: "boost_revoked_refund",
    subject_kind: "boost",
    subject_id: row.id,
    meta: { listing_id: row.listing_id, via: "stripe_refund", charge_id: chargeId },
  });
}

/** Apaga una campaña de post reembolsada por completo. Mismo criterio que el impulso. */
async function revocarCampana(
  admin: AdminClient,
  row: Extract<CompraUnica, { producto: "post_promotion" }>["row"],
  chargeId: string,
): Promise<void> {
  const ahora = new Date().toISOString();
  const { error } = await admin
    .from("post_promotions")
    .update({ status: "canceled", ends_at: ahora })
    .eq("id", row.id)
    .eq("status", "active");
  if (error) throw new Error(`update post_promotions: ${error.code}`);

  console.info(
    `[pagos:reembolso] campaña ${row.id} (tenant=${row.tenant_id} owner=${row.buyer_id}) revocada por reembolso total del cobro ${chargeId}.`,
  );

  await createNotification(admin, {
    tenantId: row.tenant_id,
    profileId: row.buyer_id,
    kind: "post_promotion",
    category: "pagos",
    ignorePrefs: true,
    title: "Te devolvimos el pago de tu campaña",
    body: "Tu publicación dejó de promocionarse. Sigue visible para tu comunidad, y podés volver a promocionarla cuando quieras.",
    href: `/impulsar-post/${row.post_id}`,
    dedupeUnread: true,
  });
  await admin.from("audit_log").insert({
    tenant_id: row.tenant_id,
    actor_id: row.buyer_id,
    action: "post_promotion_revoked_refund",
    subject_kind: "post_promotion",
    subject_id: row.id,
    meta: { post_id: row.post_id, via: "stripe_refund", charge_id: chargeId },
  });
}

/* -------------------------------------------------------------------------- */
/* Reembolso                                                                  */
/* -------------------------------------------------------------------------- */

async function atenderReembolso(admin: AdminClient, charge: Stripe.Charge): Promise<void> {
  // `charge.refunded` es el propio Stripe diciendo "devuelto ENTERO"; con un
  // parcial queda en false aunque `amount_refunded` sea grande. Es la única
  // fuente que no obliga a inventar un umbral.
  const total = charge.refunded === true;
  const devuelto = `devuelto=${charge.amount_refunded}/${charge.amount} ${charge.currency}`;
  const paymentIntentId = idDe(charge.payment_intent);

  const compra = paymentIntentId
    ? await compraUnicaDelPago(admin, paymentIntentId)
    : null;

  if (!compra) {
    // No es un pago único nuestro: o es el cobro de una suscripción, o es un
    // cobro ajeno a la app. En ninguno de los dos casos se toca nada (ver el
    // punto 3 del encabezado). Se nombra el producto afectado para que la
    // alerta sea accionable sin abrir el Dashboard a ciegas.
    const tocados = await productosDelCustomer(admin, idDe(charge.customer));
    const detalle = tocados.length > 0 ? tocados.join(" · ") : "ningún producto nuestro identificado";
    const linea =
      `[pagos:reembolso] reembolso ${total ? "TOTAL" : "PARCIAL"} del cobro ${charge.id}` +
      ` (payment_intent=${paymentIntentId ?? "—"} customer=${idDe(charge.customer) ?? "—"}) ${devuelto}` +
      ` — NO corresponde a un pago único nuestro. NO se revoca nada: si es una suscripción, quien la da de baja` +
      ` es customer.subscription.updated/.deleted. Toca: ${detalle}.`;
    if (total) console.error(`${linea} Verificar a mano si además corresponde dar de baja.`);
    else console.warn(linea);
    return;
  }

  const row = compra.row;

  if (!total) {
    // Punto 2 del encabezado: un parcial no apaga.
    console.warn(
      `[pagos:reembolso] reembolso PARCIAL del cobro ${charge.id} sobre ${compra.producto} ${row.id} (tenant=${row.tenant_id} owner=${row.buyer_id}) ${devuelto} — NO se revoca: se devolvió una parte de un servicio que sigue comprado. Si la intención era darlo de baja, hacerlo a mano.`,
    );
    return;
  }

  if (row.status !== "active") {
    // Reentrega del mismo evento, o compra que nunca llegó a activarse (por
    // ejemplo, rechazada por discrepancia de monto y devuelta después). No hay
    // beneficio encendido que apagar y no se escribe: la idempotencia es esto.
    console.info(
      `[pagos:reembolso] reembolso total del cobro ${charge.id} sobre ${compra.producto} ${row.id}, que ya está "${row.status}" — nada que revocar. ${devuelto}.`,
    );
    return;
  }

  if (compra.producto === "boost") await revocarBoost(admin, compra.row, charge.id);
  else await revocarCampana(admin, compra.row, charge.id);
}

/* -------------------------------------------------------------------------- */
/* Disputa                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Una disputa NO apaga nada (punto 4 del encabezado): deja la alerta más
 * completa posible y devuelve. Es deliberadamente el único handler de este
 * archivo que no puede escribir en ninguna rama.
 */
async function atenderDisputa(admin: AdminClient, dispute: Stripe.Dispute): Promise<void> {
  const paymentIntentId = idDe(dispute.payment_intent);
  const compra = paymentIntentId
    ? await compraUnicaDelPago(admin, paymentIntentId)
    : null;

  // `Stripe.Dispute` no trae `customer`, así que cuando el cobro disputado no es
  // de un pago único nuestro no se puede nombrar el producto sin un retrieve
  // extra del charge. No se hace: la alerta lleva charge y payment_intent, que
  // es todo lo que hace falta para encontrarlo en el Dashboard, y una llamada
  // más a Stripe dentro del webhook no compra nada que el operador no tenga.
  const sujeto = compra
    ? `${compra.producto} ${compra.row.id} (tenant=${compra.row.tenant_id} owner=${compra.row.buyer_id}, status=${compra.row.status})`
    : "producto no identificado desde el evento";

  console.error(
    `[pagos:disputa] ALERTA: se abrió una disputa por ${dispute.amount} ${dispute.currency}` +
      ` (dispute=${dispute.id} charge=${idDe(dispute.charge) ?? "—"} payment_intent=${paymentIntentId ?? "—"})` +
      ` razón="${dispute.reason}" estado="${dispute.status}". Afecta: ${sujeto}.` +
      ` NO se revoca nada: una disputa retiene la plata, no la pierde, y se puede ganar —y hoy no atendemos` +
      ` charge.dispute.closed, así que apagar acá no tendría vuelta. Responder con evidencia en el Dashboard antes del vencimiento.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Entrada única                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Atiende la plata que vuelve: reembolsos y disputas.
 *
 * Devuelve `true` si el evento es de este flujo (para que el route handler corte
 * ahí) y `false` si no. Lanza SÓLO si falla la escritura de una revocación, que
 * es el único fallo transitorio que un reintento de Stripe puede arreglar.
 */
export async function handleChargebackEvent(
  admin: AdminClient,
  event: Stripe.Event,
): Promise<boolean> {
  switch (event.type) {
    case "charge.refunded":
      await atenderReembolso(admin, event.data.object as Stripe.Charge);
      return true;

    case "charge.dispute.created":
      await atenderDisputa(admin, event.data.object as Stripe.Dispute);
      return true;

    default:
      return false;
  }
}
