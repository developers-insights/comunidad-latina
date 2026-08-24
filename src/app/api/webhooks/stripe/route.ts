import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { handleStoreMembershipEvent } from "@/app/(app)/marketplace/membresia/webhook-handlers";
import { isStripeConfigured } from "@/lib/config/services";
import { listingViewHref } from "@/lib/monetization/href";
import {
  diagnosticoDeCobro,
  metadataString,
  motivoDeDiscrepancia,
  pactadoFromMetadata,
  pactadoFromRow,
} from "@/lib/monetization/pactado";
import { handleListingPremiumEvent } from "@/lib/monetization/premium-webhook";
import { handleChargebackEvent } from "@/lib/monetization/reembolso";
import { handleInvoicePaidEvent } from "@/lib/monetization/renovacion";
import { createNotification } from "@/lib/notifications/notify";
import { PLAN_IDS, getStripe, type PlanId } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleVerificacionEvent } from "@/lib/verificacion/webhook-handlers";
import { clampScore, getTrustLevel } from "@/lib/trust/levels";
import type { Json } from "@/lib/types/database.types";
import { formatDate } from "@/lib/utils";

/**
 * Webhook de Stripe — Presencia Verificada (PLAN §7), Boost geolocalizado
 * (§7) e Identity (§5.4) — ARQUITECTURA §9.
 *
 * ⚠️ FIRMA HUMANA SENIOR REQUERIDA antes de producción (PLAN §14.4):
 * este endpoint escribe con service-role (bypassa RLS), activa planes
 * pagos/boosts y enciende `profiles.identity_verified`. Nadie lo apunta a
 * claves live sin pentest + revisión humana.
 *
 * Garantías:
 * - Firma verificada con `constructEvent` sobre el body CRUDO (req.text()).
 * - Idempotencia: `payment_events.event_id` es UNIQUE — un reintento de
 *   Stripe con un evento ya procesado devuelve 200 sin reprocesar.
 * - Respuesta 2xx rápida (<200ms objetivo): solo writes puntuales por
 *   evento; nada de trabajo pesado inline.
 * - Stripe sin configurar → 503 con log (degradación §5.6, nunca crash).
 * - Identity §5.4: del documento NO llega ni se persiste NADA — solo el
 *   sí/no que enciende el flag del perfil. El payload de Identity que queda
 *   en payment_events no contiene el documento (y se purga a los 90 días).
 */

export const runtime = "nodejs";

/**
 * Cuánto vale un reclamo de `payment_events.claimed_at` antes de que otra
 * entrega pueda volver a tomarlo (0111).
 *
 * Cinco minutos, contra el techo de 300 s de una función de Vercel: si el
 * proceso que lo reclamó todavía estuviera vivo, ya se habría pasado del tiempo
 * que la plataforma le da. Un reclamo sin vencimiento cambiaría un duplicado
 * por un evento que nadie procesa nunca, que con plata de por medio es peor.
 */
const RECLAMO_VENCE_MS = 5 * 60 * 1000;

/** Estados de suscripción de Stripe que mantienen la presencia activa. */
const ACTIVE_SUB_STATUSES: ReadonlyArray<Stripe.Subscription.Status> = [
  "active",
  "trialing",
];

/**
 * `plan` de la metadata validado contra el allow-list de PlanId. Un valor
 * fuera del enum (metadata mal seteada desde el dashboard, typo, etc.)
 * devuelve null — jamás se persiste un tier desconocido.
 */
function metadataPlan(
  metadata: Stripe.Metadata | null | undefined,
): PlanId | null {
  const value = metadataString(metadata, "plan");
  if (!value) return null;
  if ((PLAN_IDS as readonly string[]).includes(value)) return value as PlanId;
  console.warn(
    `[pagos:webhook] plan desconocido en metadata ("${value}") — se ignora.`,
  );
  return null;
}

export async function POST(request: Request) {
  if (!isStripeConfigured || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn(
      "[pagos:webhook] Request recibido con Stripe sin configurar (faltan STRIPE_SECRET_KEY y/o STRIPE_WEBHOOK_SECRET) — 503.",
    );
    return NextResponse.json(
      { error: "Stripe no configurado" },
      { status: 503 },
    );
  }

  // 1. Verificación de firma sobre el body CRUDO — antes de tocar nada.
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Falta firma" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    console.warn("[pagos:webhook] Firma inválida — 400.");
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  const admin = createAdminClient();
  const objeto = event.data.object as { metadata?: Stripe.Metadata | null };
  const tenantId = metadataString(objeto.metadata, "tenant_id");

  // 2. Idempotencia: insert con event_id UNIQUE. Conflicto → ya lo vimos.
  //    `claimed_at` va desde el INSERT: quien gana la carrera queda marcado como
  //    el que lo está procesando, que es justo lo que la rama del 23505 de abajo
  //    necesita poder distinguir.
  const { error: insertError } = await admin.from("payment_events").insert({
    provider: "stripe",
    event_id: event.id,
    event_type: event.type,
    payload: JSON.parse(rawBody) as Json,
    tenant_id: tenantId,
    claimed_at: new Date().toISOString(),
  });

  if (insertError) {
    if (insertError.code === "23505") {
      /**
       * Perdimos la carrera del INSERT: alguien más ya registró este evento.
       * La pregunta no es "¿ya se procesó?" sino "¿hay alguien procesándolo
       * AHORA?" — y `processed=false` no distingue una cosa de la otra: es el
       * estado tanto del intento que murió a mitad como del que está vivo y
       * trabajando. Leerlo y seguir de largo, que es lo que se hacía acá,
       * hacía que dos entregas simultáneas procesaran las dos.
       *
       * El reclamo lo resuelve en un solo UPDATE atómico: se lo lleva quien
       * encuentre la fila libre (`claimed_at` nulo) o con un reclamo vencido
       * —más de 5 minutos, o sea un proceso que ya no puede estar vivo contra
       * el techo de 300 s de Vercel—. Cero filas devueltas ⇒ hay alguien
       * adentro, o ya terminó: respondemos 200 y no tocamos nada.
       *
       * Ver `supabase/migrations/0111_reclamo_de_evento_de_pago.sql` para por
       * qué no alcanzaba con un UPDATE sobre `processed` ni con un advisory
       * lock.
       */
      const vencimientoDelReclamo = new Date(Date.now() - RECLAMO_VENCE_MS).toISOString();
      const { data: reclamado } = await admin
        .from("payment_events")
        .update({ claimed_at: new Date().toISOString() })
        .eq("provider", "stripe")
        .eq("event_id", event.id)
        .eq("processed", false)
        .or(`claimed_at.is.null,claimed_at.lt.${vencimientoDelReclamo}`)
        .select("id")
        .maybeSingle();

      if (!reclamado) {
        return NextResponse.json({ received: true, duplicated: true });
      }
      // Nos lo llevamos: el intento anterior murió a mitad. Seguimos.
    } else {
      console.error(
        `[pagos:webhook] No se pudo registrar payment_event ${event.id} — code=${insertError.code}`,
      );
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  }

  // 3. Procesamiento — corto y puntual para responder 2xx rápido.
  try {
    // Membresía de tienda (§7, USD 10/mes): se reconoce por
    // metadata.kind='store_membership' y la maneja su propio módulo, junto a la
    // action que abre su Checkout. Devuelve true ⇒ el evento ya está atendido y
    // ningún otro flujo lo mira. Si devuelve false, sigue el switch de siempre.
    if (await handleStoreMembershipEvent(admin, event)) {
      await admin
        .from("payment_events")
        .update({ processed: true })
        .eq("provider", "stripe")
        .eq("event_id", event.id);
      return NextResponse.json({ received: true });
    }

    // Premium de una publicación (§3, 0054): se reconoce por
    // metadata.kind='listing_premium' y lo maneja su propio módulo, junto a la
    // lógica pura del tier. Mismo contrato que la membresía de tienda: devuelve
    // true ⇒ el evento ya está atendido y ningún otro flujo lo mira. Es el ÚNICO
    // camino por el que un aviso llega a tier='premium' — antes de esto el tier
    // se concedía a mano con service_role, que no es autoservicio ni se puede
    // dar de baja solo.
    if (await handleListingPremiumEvent(admin, event)) {
      await admin
        .from("payment_events")
        .update({ processed: true })
        .eq("provider", "stripe")
        .eq("event_id", event.id);
      return NextResponse.json({ received: true });
    }

    // CHECK AZUL (0101): se reconoce por metadata.kind='verificacion' y lo maneja
    // su propio módulo, junto a la action que abre su Checkout. Mismo contrato
    // que los dos de arriba: devuelve true ⇒ el evento ya está atendido.
    //
    // ⚠️ VA ANTES QUE `handleInvoicePaidEvent`, Y NO ES UN DETALLE DE ESTILO.
    // Ese handler devuelve true para TODA factura, incluso para las que no
    // reconoce, y el route corta acá mismo. Puesto después, el check azul nunca
    // vería un `invoice.paid` — que es justo el evento del que cuelga su impulso
    // de regalo mensual. La insignia andaría y el regalo no llegaría jamás, sin
    // un solo error en los logs. Este handler devuelve false apenas ve que el
    // `kind` no es el suyo, así que adelantarlo no le cambia el comportamiento a
    // ningún otro producto.
    if (await handleVerificacionEvent(admin, event)) {
      await admin
        .from("payment_events")
        .update({ processed: true })
        .eq("provider", "stripe")
        .eq("event_id", event.id);
      return NextResponse.json({ received: true });
    }

    // RENOVACIONES (`invoice.paid`): el cobro mensual de los TRES productos por
    // suscripción, que hasta acá no pasaba por ninguna verificación porque el
    // estado viajaba sólo en `customer.subscription.*`, que no trae plata.
    //
    // ⚠️ ESTE HANDLER OBSERVA, NO DECIDE: correlaciona la factura con nuestra
    // fila, registra el ciclo y avisa si el monto se corrió del pactado — pero no
    // escribe nada y nunca lanza. El porqué de esa asimetría con el alta (una
    // renovación se cobra al precio de la suscripción EN STRIPE, y rechazarla
    // sería apagarle el servicio a alguien que pagó) está entero en
    // `lib/monetization/renovacion.ts`. Va DESPUÉS de los otros dos porque ellos
    // no miran facturas y devuelven false enseguida.
    if (await handleInvoicePaidEvent(admin, event)) {
      await admin
        .from("payment_events")
        .update({ processed: true })
        .eq("provider", "stripe")
        .eq("event_id", event.id);
      return NextResponse.json({ received: true });
    }

    // LA PLATA QUE VUELVE (`charge.refunded`, `charge.dispute.created`): hasta
    // acá se devolvía el dinero y el beneficio seguía encendido —el tablero de
    // ingresos (0074) ya descontaba el reembolso, la aplicación no revocaba
    // nada—. REVOCA UN SOLO CASO, el inequívoco: el reembolso TOTAL de un pago
    // único (impulso, campaña). Un parcial, una disputa y cualquier reembolso de
    // suscripción alertan y no tocan nada; el porqué de cada uno está entero en
    // `lib/monetization/reembolso.ts`. Va acá abajo por lo mismo que
    // renovaciones: los tres handlers de arriba no miran cobros y devuelven
    // false enseguida.
    if (await handleChargebackEvent(admin, event)) {
      await admin
        .from("payment_events")
        .update({ processed: true })
        .eq("provider", "stripe")
        .eq("event_id", event.id);
      return NextResponse.json({ received: true });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Boost (§7): checkout one-time con metadata.boost_id — lo activa
        // SOLO este webhook cuando el pago está confirmado.
        const boostId = metadataString(session.metadata, "boost_id");
        if (boostId) {
          if (session.payment_status === "paid") {
            await activateBoost(admin, boostId, session);
          }
          // unpaid (métodos async) → espera checkout.session.async_payment_succeeded.
          break;
        }

        // Campaña de post (feedback cliente 2026-07-19): checkout one-time con
        // metadata.post_promotion_id — misma disciplina que el boost, la activa
        // SOLO este webhook al confirmarse el pago.
        const postPromotionId = metadataString(session.metadata, "post_promotion_id");
        if (postPromotionId) {
          if (session.payment_status === "paid") {
            await activatePostPromotion(admin, postPromotionId, session);
          }
          break;
        }

        // Presencia Verificada (§7): suscripción con metadata.business_account_id.
        // `unpaid` (métodos async) espera al async_payment_succeeded de abajo.
        await activateVerifiedPresence(admin, session, event.id);
        break;
      }

      case "checkout.session.async_payment_succeeded": {
        // Pago async (p. ej. transferencia) confirmado después del completed.
        const session = event.data.object as Stripe.Checkout.Session;
        const boostId = metadataString(session.metadata, "boost_id");
        if (boostId) await activateBoost(admin, boostId, session);
        const postPromotionId = metadataString(session.metadata, "post_promotion_id");
        if (postPromotionId) await activatePostPromotion(admin, postPromotionId, session);
        // Presencia también entra por acá, y ANTES no: exigirle `paid` al
        // completed sin atender este evento dejaría la presencia sin encender
        // nunca tras un pago diferido real. El arreglo no puede cambiar
        // "concede sin cobrar" por "cobra sin conceder".
        if (!boostId && !postPromotionId) {
          await activateVerifiedPresence(admin, session, event.id);
        }
        break;
      }

      case "identity.verification_session.verified": {
        // §5.4: lo ÚNICO que entra a la DB es el sí — jamás el documento.
        const session = event.data.object as Stripe.Identity.VerificationSession;
        await handleIdentityVerified(admin, session);
        break;
      }

      case "identity.verification_session.requires_input": {
        const session = event.data.object as Stripe.Identity.VerificationSession;
        await handleIdentityRequiresInput(admin, session);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await syncPresenciaFromSubscription(admin, subscription, event.id);
        break;
      }

      case "customer.subscription.deleted": {
        // NO lleva la correlación de `.updated` a propósito: esta rama sólo QUITA
        // (plan 'none', presencia apagada). Toda verificación de más acá es una
        // forma nueva de NO apagar algo que dejó de pagarse, y la metadata no
        // puede conceder nada por este camino. La fila la sigue eligiendo el id
        // de la suscripción, que es de Stripe y no se falsifica desde metadata.
        const subscription = event.data.object as Stripe.Subscription;
        const { error } = await admin
          .from("business_accounts")
          .update({
            plan: "none",
            plan_status: "canceled",
            verified_presence: false,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);
        if (error) throw new Error(`update business_accounts: ${error.code}`);
        break;
      }

      default:
        // Evento no manejado: queda registrado en payment_events y listo.
        break;
    }

    await admin
      .from("payment_events")
      .update({ processed: true })
      .eq("provider", "stripe")
      .eq("event_id", event.id);

    return NextResponse.json({ received: true });
  } catch (error) {
    // Se guarda el error y se responde 500 → Stripe reintenta; el reintento
    // encuentra processed=false y reprocesa (ver paso 2).
    const message = error instanceof Error ? error.message : "error desconocido";
    console.error(
      `[pagos:webhook] Error procesando ${event.type} ${event.id}: ${message}`,
    );
    await admin
      .from("payment_events")
      .update({ processed: false, error: message })
      .eq("provider", "stripe")
      .eq("event_id", event.id);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Handlers — cortos y puntuales; lanzan para que el retry de Stripe reprocese
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

// El mapeo kind→ruta NO se escribe acá: vive en `listingViewHref`
// (src/lib/monetization/href.ts), que cubre los 7 valores de `listings.kind` y
// nunca devuelve null. Este archivo tenía su propia copia con 3 de los 7, así
// que impulsar un empleo, un negocio, un producto o una colaboración —todas
// compras que SÍ se cobran— emitía el comprobante "¡Tu impulso ya está
// activo!" con href null, que la bandeja pinta como un botón muerto.

/** El customer de una Session, venga como id o como objeto expandido. */
function customerId(
  customer: string | { id: string } | null | undefined,
): string | null {
  if (typeof customer === "string") return customer;
  return customer?.id ?? null;
}

/**
 * Enciende Presencia Verificada (§7) tras un pago CONFIRMADO.
 *
 * ESTE ERA EL ÚNICO PUNTO DE COBRO QUE NO VERIFICABA NADA. Los otros cuatro
 * productos (boost, campaña de post, premium de aviso, membresía de tienda) ya
 * exigían pago y monto; presencia escribía `plan_status='active'` y
 * `verified_presence=true` con sólo mirar que la metadata trajera una cuenta y
 * un plan. Consecuencia concreta: un `checkout.session.completed` con
 * `payment_status: 'unpaid'` —lo NORMAL en métodos de pago asíncronos— entregaba
 * la presencia sin que hubiera entrado un centavo.
 *
 * CORRELACIÓN OBLIGATORIA (fiscal R3), en este orden y por este motivo:
 *   (0) PLATA ADENTRO: `payment_status === 'paid'`. Cualquier otro valor
 *       (`unpaid`, `no_payment_required`) espera al async_payment_succeeded.
 *   (a) LA CUENTA existe, es DE ESTE TENANT y su dueño es el `owner_id` de la
 *       metadata. Sin lo primero, una metadata que apunte a la cuenta de otra
 *       comunidad enciende presencia cruzada; sin lo segundo, una que apunte a
 *       la cuenta de OTRO VECINO del mismo tenant enciende la presencia ajena.
 *       Es la misma exigencia que hace `premium-webhook.ts` sobre el aviso.
 *   (b) QUIEN PAGÓ es el customer ya vinculado a esa cuenta, cuando la cuenta ya
 *       tiene uno. En la primera compra todavía no hay con qué comparar (lo
 *       escribe este mismo webhook) — y ESE hueco es justamente el que tapa el
 *       `owner_id` de (a), que sí está desde el primer peso.
 *   (c) EL MONTO **Y LA MONEDA** contra lo PACTADO al abrir el Checkout
 *       (`metadata.price_cents`/`price_currency`, que escribe
 *       `iniciarSuscripcion`), NO contra una constante ni contra `tenant_prices`:
 *       si alguien edita el precio de la comunidad entre el Checkout y el
 *       evento, releer la tabla acá rechazaría un cobro legítimo. Ver
 *       `lib/monetization/pactado.ts`.
 *
 * Discrepancia → log de ALERTA con session, cuenta, lo cobrado y la metadata
 * cruda, y NO se concede, SIN throw: reintentar no arregla una discrepancia de
 * monto, y el payload ya quedó en `payment_events` para reconciliar. Lanzar
 * dejaría a Stripe reintentando un evento que nunca va a poder aplicarse.
 */
async function activateVerifiedPresence(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<void> {
  const businessAccountId = metadataString(session.metadata, "business_account_id");
  const tenantId = metadataString(session.metadata, "tenant_id");
  const ownerId = metadataString(session.metadata, "owner_id");
  const plan = metadataPlan(session.metadata);
  if (!businessAccountId || !plan || !tenantId || !ownerId) {
    // `owner_id` se exige SIEMPRE, sin camino de gracia para Sessions viejas.
    //
    // SESSIONS ANTERIORES AL DEPLOY: `iniciarSuscripcion` es el ÚNICO lugar que
    // abre estos Checkouts, así que las únicas sin `owner_id` son las emitidas
    // antes de este cambio — y una Checkout Session de Stripe expira a las 24 h,
    // de modo que la ventana en la que podría llegar un `completed` sin el campo
    // se cierra sola. Tolerarlas con un segundo camino "para los viejos" sería
    // dejar abierta, para siempre, exactamente la verificación que se está
    // agregando: basta con omitir el campo para saltearla. Y el rechazo no es
    // silencio: queda este log y el payload íntegro en `payment_events`, que es
    // todo lo que hace falta para conceder a mano o devolver la plata.
    console.warn(
      `[pagos:webhook] ${eventId} (session ${session.id}) sin metadata válida de business_account/plan/tenant/owner — NO se concede. ${diagnosticoDeCobro(session)}. Si trae plata adentro, reconciliar a mano en el Dashboard.`,
    );
    return;
  }

  // (0) Sin plata adentro no se entrega. Es el camino normal del pago diferido,
  // no una anomalía: warn, no error.
  if (session.payment_status !== "paid") {
    console.warn(
      `[pagos:webhook] presencia: la session ${session.id} (cuenta ${businessAccountId}) llegó con payment_status="${session.payment_status}" — NO se concede todavía; se espera checkout.session.async_payment_succeeded.`,
    );
    return;
  }

  // (a) La cuenta tiene que existir, ser de este tenant y ser DE QUIEN COMPRÓ.
  const { data: account, error: accountError } = await admin
    .from("business_accounts")
    .select("id, tenant_id, owner_id, stripe_customer_id")
    .eq("id", businessAccountId)
    .maybeSingle();
  if (accountError) throw new Error(`select business_accounts: ${accountError.code}`);
  if (!account || account.tenant_id !== tenantId || account.owner_id !== ownerId) {
    console.error(
      `[pagos:webhook] ALERTA presencia: la session ${session.id} pagó por la cuenta ${businessAccountId}, que no existe, no es del tenant ${tenantId} (tenant real: ${account?.tenant_id ?? "—"}) o cambió de dueño (dueño real: ${account?.owner_id ?? "—"} ≠ metadata ${ownerId}) — NO se concede. ${diagnosticoDeCobro(session)}. Revisar refund en el Dashboard.`,
    );
    return;
  }

  // (b) Quien pagó, contra el customer ya vinculado a la cuenta.
  const cobradoA = customerId(session.customer);
  if (account.stripe_customer_id && cobradoA && account.stripe_customer_id !== cobradoA) {
    console.error(
      `[pagos:webhook] ALERTA presencia: la session ${session.id} la pagó ${cobradoA}, pero la cuenta ${businessAccountId} (dueño ${account.owner_id}) está vinculada a ${account.stripe_customer_id} — NO se concede. ${diagnosticoDeCobro(session)}.`,
    );
    return;
  }

  // (c) El monto Y la moneda, contra lo pactado en la Session.
  const pactado = pactadoFromMetadata(session.metadata);
  if (!pactado) {
    console.error(
      `[pagos:webhook] ALERTA presencia: la session ${session.id} (cuenta ${businessAccountId}) no trae un precio pactado legible en metadata — NO se concede. ${diagnosticoDeCobro(session)}. Reconciliar a mano en el Dashboard.`,
    );
    return;
  }
  const discrepancia = motivoDeDiscrepancia(session, pactado);
  if (discrepancia) {
    console.error(
      `[pagos:webhook] ALERTA presencia: la session ${session.id} (cuenta ${businessAccountId}) ${discrepancia} — NO se concede. ${diagnosticoDeCobro(session)}.`,
    );
    return;
  }

  const { error } = await admin
    .from("business_accounts")
    .update({
      plan,
      plan_status: "active",
      stripe_customer_id: cobradoA,
      stripe_subscription_id:
        typeof session.subscription === "string"
          ? session.subscription
          : (session.subscription?.id ?? null),
      verified_presence: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", businessAccountId);
  if (error) throw new Error(`update business_accounts: ${error.code}`);
}

/**
 * Sincroniza el estado de Presencia Verificada desde `customer.subscription.updated`.
 *
 * ESTA RAMA ERA LA ÚLTIMA DONDE LA METADATA CONCEDÍA NIVEL. Escribía
 * `plan: metadata.plan` filtrando SÓLO por `stripe_subscription_id`, sin exigir
 * que la suscripción fuera de presencia ni cruzar el dueño: quien pudiera editar
 * la metadata de una suscripción en el Dashboard de Stripe se ascendía de
 * `basico` a `pro` sin pagar la diferencia. Es el mismo patrón que ya se cerró en
 * los otros tres productos; sólo el vector (Dashboard, no internet) era menor.
 *
 * QUÉ CAMBIA, EN TRES REGLAS:
 *
 *  (0) SÓLO PRESENCIA. Presencia NUNCA escribe `kind` en su metadata (lo escriben
 *      la membresía de tienda y el premium de aviso, y sus handlers ya cortaron
 *      antes de llegar acá). Una suscripción con `kind` cualquiera no es
 *      presencia y no puede tocar `business_accounts`.
 *
 *  (a) LA FILA LA ELIGE EL ID DE LA SUSCRIPCIÓN, NUNCA LA METADATA — igual que en
 *      `premium-webhook.ts` y en la membresía. Y se LEE antes de escribir, que es
 *      lo que permite las dos reglas siguientes; el `update` a ciegas de antes no
 *      tenía contra qué comparar nada.
 *
 *  (b) EL SNAPSHOT TIENE QUE SEGUIR DESCRIBIENDO ESTA FILA. `tenant_id`,
 *      `business_account_id` y `owner_id` los escribió `iniciarSuscripcion` en
 *      `subscription_data.metadata` al abrir el Checkout. Si alguno viene y NO
 *      coincide con la fila, la suscripción quedó apuntando a otra comunidad o a
 *      otro dueño: no se escribe NADA (ni siquiera el estado, que aplicado a la
 *      fila equivocada es tan dañino como conceder) y queda la alerta. Los campos
 *      que NO vienen no bloquean: una suscripción anterior a que se agregara
 *      `owner_id` vive para siempre y seguiría mandando eventos legítimos —a
 *      diferencia de una Checkout Session, que expira a las 24 h y por eso allá
 *      sí se exige sin camino de gracia.
 *
 *  (c) EL PLAN NO SE TOMA DE LA METADATA. NUNCA, ni cuando todo lo demás coincide:
 *      la metadata de una suscripción es editable desde el Dashboard, así que
 *      corroborar la identidad no protege el nivel —el atacante edita `plan` y
 *      deja el resto intacto—. El plan lo fija el ALTA (`activateVerifiedPresence`,
 *      contra el precio pactado en la Session) y lo baja `.deleted`, que son los
 *      dos únicos caminos donde hay plata verificada de por medio. Un cambio de
 *      plan en la app abre un Checkout NUEVO y vuelve a pasar por el alta, así
 *      que esta rama no necesita conceder nunca. Es exactamente lo que ya hacen
 *      `syncFromSubscription` de la tienda y del premium: mueven estado, no nivel.
 *      Si la metadata dice un plan distinto al de la fila, eso ES la señal de que
 *      alguien la tocó: se alerta y se sincroniza sólo el estado.
 *
 * Ante discrepancia: no se escribe, log diagnosticable y 200 SIN throw. Un 500
 * pondría a Stripe reintentando tres días algo que ningún reintento arregla.
 */
async function syncPresenciaFromSubscription(
  admin: AdminClient,
  subscription: Stripe.Subscription,
  eventId: string,
): Promise<void> {
  // (0) ¿Es de presencia?
  const kind = metadataString(subscription.metadata, "kind");
  if (kind) {
    console.warn(
      `[pagos:webhook] ${eventId}: la suscripción ${subscription.id} trae kind="${kind}" — no es Presencia Verificada y no se toca business_accounts.`,
    );
    return;
  }

  // (a) La fila, por id de suscripción.
  const { data: account, error: selectError } = await admin
    .from("business_accounts")
    .select("id, tenant_id, owner_id, plan")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  if (selectError) throw new Error(`select business_accounts: ${selectError.code}`);
  if (!account) {
    // No es nuestra, o el evento llegó antes que el alta. Sin throw: reintentar
    // no la va a hacer aparecer.
    console.warn(
      `[pagos:webhook] ${eventId}: la suscripción ${subscription.id} no tiene cuenta de negocio asociada — se ignora.`,
    );
    return;
  }

  // (b) El snapshot contra la fila.
  const cuentaMeta = metadataString(subscription.metadata, "business_account_id");
  const tenantMeta = metadataString(subscription.metadata, "tenant_id");
  const ownerMeta = metadataString(subscription.metadata, "owner_id");
  const cruzado =
    (cuentaMeta !== null && cuentaMeta !== account.id) ||
    (tenantMeta !== null && tenantMeta !== account.tenant_id) ||
    (ownerMeta !== null && ownerMeta !== account.owner_id);
  if (cruzado) {
    console.error(
      `[pagos:webhook] ALERTA presencia: la suscripción ${subscription.id} dice cuenta=${cuentaMeta} tenant=${tenantMeta} owner=${ownerMeta}, pero la fila que le corresponde es ${account.id} (tenant=${account.tenant_id} owner=${account.owner_id}) — NO se escribe nada. Reconciliar a mano en el Dashboard.`,
    );
    return;
  }

  // (c) El plan de la metadata NO se escribe; si difiere, es señal de que alguien
  // la editó y merece quedar registrado.
  const planMeta = metadataPlan(subscription.metadata);
  if (planMeta && planMeta !== account.plan) {
    console.error(
      `[pagos:webhook] ALERTA presencia: la metadata de la suscripción ${subscription.id} dice plan="${planMeta}" y la cuenta ${account.id} tiene "${account.plan}" — se sincroniza el ESTADO, el plan NO se toca (sólo lo concede un Checkout cobrado). Verificar en el Dashboard si el cambio fue intencional.`,
    );
  }

  const activa = ACTIVE_SUB_STATUSES.includes(subscription.status);
  const { error } = await admin
    .from("business_accounts")
    .update({
      plan_status: subscription.status,
      verified_presence: activa,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  if (error) throw new Error(`update business_accounts: ${error.code}`);
}

/**
 * Activa un boost pagado (§7): status active + ventana [now, now + días].
 *
 * IDEMPOTENTE INCLUSO ANTE DOS ENTREGAS A LA VEZ, y eso no lo daba el `if` de
 * estado: la transición se gatea en el `WHERE` del UPDATE
 * (`.eq("status","pending_payment")`), así que Postgres serializa y la segunda
 * ejecución no toca ninguna fila. La idempotencia por `event_id` no alcanzaba
 * acá — dos ramas distintas del switch llaman a esta función desde eventos
 * DISTINTOS, y ante un 23505 con `processed=false` el route reprocesa a
 * propósito. Sin el predicado: `ends_at` pisado, dos notificaciones al
 * comprador y dos filas de auditoría.
 *
 * CORRELACIÓN OBLIGATORIA (fiscal R3): la metadata sola no alcanza — antes de
 * activar se exige que (a) el boost siga `pending_payment` (un
 * async_payment_succeeded tardío NO re-activa un boost que un admin canceló o
 * que ya expiró), (b) la session del evento sea EXACTAMENTE la vinculada en
 * crearBoostCheckout (una session vieja de un retry de checkout no activa), y
 * (c) el monto **Y LA MONEDA** cobrados coincidan con los del boost.
 * Discrepancia → log de alerta + NO activar (sin throw: reintentar no lo
 * arregla; el payload queda en payment_events para reconciliar a mano).
 *
 * LA MONEDA NO ES UN ADORNO. Comparar sólo `amount_total` contra `amount_cents`
 * es comparar dos enteros sin unidad: 1000 ARS y 1000 usd dan el mismo número y
 * no son el mismo cobro. Hoy los dos lados los escribe nuestro propio código
 * desde la MISMA lectura de precio, así que no es explotable — pero es
 * exactamente el agujero que ya se cerró en presencia y en el premium de un
 * aviso, y dejarlo abierto acá era esperar a que un tercer camino de escritura
 * lo volviera real.
 */
async function activateBoost(
  admin: AdminClient,
  boostId: string,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const { data: boost, error: selectError } = await admin
    .from("boosts")
    .select(
      "id, tenant_id, listing_id, buyer_id, duration_days, status, amount_cents, currency, stripe_checkout_session_id, listings(kind)",
    )
    .eq("id", boostId)
    .maybeSingle();
  if (selectError) throw new Error(`select boosts: ${selectError.code}`);
  if (!boost) {
    console.warn(`[pagos:webhook] boost ${boostId} no existe — se ignora.`);
    return;
  }
  if (boost.status === "active") return; // retry: ya activado
  if (boost.status !== "pending_payment") {
    console.error(
      `[pagos:webhook] ALERTA boost ${boostId}: pago confirmado (${session.id}) pero el boost está "${boost.status}" (¿cancelado/expirado por admin?) — NO se activa. Revisar refund en el Dashboard.`,
    );
    return;
  }
  if (!boost.stripe_checkout_session_id || boost.stripe_checkout_session_id !== session.id) {
    console.error(
      `[pagos:webhook] ALERTA boost ${boostId}: la session ${session.id} no coincide con la vinculada (${boost.stripe_checkout_session_id ?? "ninguna"}) — NO se activa.`,
    );
    return;
  }

  // (c) MONTO Y MONEDA, contra lo que quedó escrito en la fila al abrir el
  // Checkout (ver `pactadoFromRow`). La comparación en sí la hace
  // `motivoDeDiscrepancia`, la MISMA que usan presencia y el premium: la regla
  // vive en un solo lugar.
  const pactado = pactadoFromRow(boost);
  if (!pactado) {
    console.error(
      `[pagos:webhook] ALERTA boost ${boostId}: la fila no tiene un precio legible (amount_cents=${boost.amount_cents}, currency="${boost.currency}") — NO se activa. ${diagnosticoDeCobro(session)}. Reconciliar a mano en el Dashboard.`,
    );
    return;
  }
  // Un impulso es un pago ÚNICO: `amount_total` y `currency` vienen siempre.
  // Que falte alguno no es "nada que comparar" (que es lo que asume
  // `motivoDeDiscrepancia`, pensada también para suscripciones), es un cobro
  // que no se puede verificar — y lo que no se verifica no se entrega.
  if (typeof session.amount_total !== "number" || typeof session.currency !== "string") {
    console.error(
      `[pagos:webhook] ALERTA boost ${boostId}: la session ${session.id} no trae monto y moneda verificables — NO se activa. ${diagnosticoDeCobro(session)}.`,
    );
    return;
  }
  const discrepancia = motivoDeDiscrepancia(session, pactado);
  if (discrepancia) {
    console.error(
      `[pagos:webhook] ALERTA boost ${boostId}: ${discrepancia} — NO se activa. ${diagnosticoDeCobro(session)}.`,
    );
    return;
  }

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + boost.duration_days * 86_400_000);

  // EL ESTADO SE EXIGE OTRA VEZ ACÁ, EN EL `WHERE`, Y NO ES REDUNDANTE.
  //
  // El `if (boost.status !== "pending_payment")` de arriba mira una fila que se
  // leyó hace unas líneas: entre esa lectura y esta escritura cabe otra entrega
  // del MISMO pago. La idempotencia por `event_id` no la cubre —dos eventos
  // distintos (`completed` y `async_payment_succeeded`) llaman a esta misma
  // función, y ante un 23505 con `processed=false` el route reprocesa a
  // propósito—, así que las dos ejecuciones pueden ver `pending_payment` y
  // seguir. Con el predicado en el `WHERE`, Postgres serializa los dos updates
  // y el segundo no matchea NINGUNA fila: no se pisa `ends_at`, no se manda una
  // segunda notificación "¡Tu impulso ya está activo!" y no se duplica la
  // auditoría. Mismo patrón que `transitionContract`
  // (src/app/(app)/creadores/actions.ts).
  const { data: activados, error: updateError } = await admin
    .from("boosts")
    .update({
      status: "active",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq("id", boost.id)
    .eq("status", "pending_payment")
    .select("id");
  if (updateError) throw new Error(`update boosts: ${updateError.code}`);
  if ((activados ?? []).length === 0) {
    // Cero filas NO es un error: es "otra entrega del mismo pago llegó primero".
    // Éxito, y se corta acá para no duplicar los efectos de al lado.
    console.warn(
      `[pagos:webhook] boost ${boost.id}: otra entrega del pago (${session.id}) lo activó primero — no se duplican notificación ni auditoría.`,
    );
    return;
  }

  // Notificación + auditoría: best-effort, jamás rompen la activación.
  await createNotification(admin, {
    tenantId: boost.tenant_id,
    profileId: boost.buyer_id,
    kind: "boost",
    category: "publicidad",
    // `ignorePrefs`: le llega a quien PAGÓ el impulso. Silenciar "Publicidad"
    // es no querer que te promocionen cosas, no renunciar al comprobante de lo
    // que compraste.
    ignorePrefs: true,
    title: "¡Tu impulso ya está activo!",
    body: `Tu aviso aparece primero en tu zona, marcado como "Patrocinado", hasta el ${formatDate(endsAt, { style: "long" })}.`,
    href: listingViewHref(boost.listings?.kind, boost.listing_id),
  });
  // Best-effort SÍ, mudo NO: si la auditoría de una activación paga se pierde,
  // el rastro de por qué ese impulso está activo desaparece sin dejar señal.
  const { error: auditError } = await admin.from("audit_log").insert({
    tenant_id: boost.tenant_id,
    actor_id: boost.buyer_id,
    action: "boost_activated",
    subject_kind: "boost",
    subject_id: boost.id,
    meta: { listing_id: boost.listing_id, duration_days: boost.duration_days },
  });
  if (auditError) {
    console.error(
      `[pagos:webhook] boost ${boost.id} quedó ACTIVO pero no se pudo auditar — code=${auditError.code}. La activación es válida; falta el rastro.`,
    );
  }
}

/**
 * Activa una campaña de post pagada (feedback cliente 2026-07-19): status
 * active + ventana [now, now + días]. Misma disciplina de correlación que
 * activateBoost (fiscal R3), incluida la MONEDA: antes de activar exige que (a)
 * la campaña siga `pending_payment`, (b) la session del evento sea EXACTAMENTE
 * la vinculada al crearla, y (c) el monto Y la moneda cobrados coincidan.
 * Discrepancia → log de alerta + NO activar (sin throw: reintentar no lo
 * arregla; queda en payment_events para reconciliar a mano). Idempotente hasta
 * ante entregas CONCURRENTES, por el mismo predicado de estado en el `WHERE`
 * que usa `activateBoost` — ver su docblock.
 */
async function activatePostPromotion(
  admin: AdminClient,
  promotionId: string,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const { data: promo, error: selectError } = await admin
    .from("post_promotions")
    .select(
      "id, tenant_id, post_id, buyer_id, duration_days, status, amount_cents, currency, stripe_checkout_session_id",
    )
    .eq("id", promotionId)
    .maybeSingle();
  if (selectError) throw new Error(`select post_promotions: ${selectError.code}`);
  if (!promo) {
    console.warn(`[pagos:webhook] post_promotion ${promotionId} no existe — se ignora.`);
    return;
  }
  if (promo.status === "active") return; // retry: ya activada
  if (promo.status !== "pending_payment") {
    console.error(
      `[pagos:webhook] ALERTA post_promotion ${promotionId}: pago confirmado (${session.id}) pero está "${promo.status}" (¿cancelada/expirada?) — NO se activa. Revisar refund en el Dashboard.`,
    );
    return;
  }
  if (
    !promo.stripe_checkout_session_id ||
    promo.stripe_checkout_session_id !== session.id
  ) {
    console.error(
      `[pagos:webhook] ALERTA post_promotion ${promotionId}: la session ${session.id} no coincide con la vinculada (${promo.stripe_checkout_session_id ?? "ninguna"}) — NO se activa.`,
    );
    return;
  }

  // (c) MONTO Y MONEDA — mismo criterio y misma regla compartida que el boost.
  const pactado = pactadoFromRow(promo);
  if (!pactado) {
    console.error(
      `[pagos:webhook] ALERTA post_promotion ${promotionId}: la fila no tiene un precio legible (amount_cents=${promo.amount_cents}, currency="${promo.currency}") — NO se activa. ${diagnosticoDeCobro(session)}. Reconciliar a mano en el Dashboard.`,
    );
    return;
  }
  if (typeof session.amount_total !== "number" || typeof session.currency !== "string") {
    console.error(
      `[pagos:webhook] ALERTA post_promotion ${promotionId}: la session ${session.id} no trae monto y moneda verificables — NO se activa. ${diagnosticoDeCobro(session)}.`,
    );
    return;
  }
  const discrepancia = motivoDeDiscrepancia(session, pactado);
  if (discrepancia) {
    console.error(
      `[pagos:webhook] ALERTA post_promotion ${promotionId}: ${discrepancia} — NO se activa. ${diagnosticoDeCobro(session)}.`,
    );
    return;
  }

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + promo.duration_days * 86_400_000);

  // Mismo predicado de estado en el `WHERE` que en `activateBoost`, y por lo
  // mismo: dos entregas concurrentes del mismo pago leen las dos
  // `pending_payment`. Ver el comentario largo allá arriba.
  const { data: activadas, error: updateError } = await admin
    .from("post_promotions")
    .update({
      status: "active",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq("id", promo.id)
    .eq("status", "pending_payment")
    .select("id");
  if (updateError) throw new Error(`update post_promotions: ${updateError.code}`);
  if ((activadas ?? []).length === 0) {
    console.warn(
      `[pagos:webhook] post_promotion ${promo.id}: otra entrega del pago (${session.id}) la activó primero — no se duplican notificación ni auditoría.`,
    );
    return;
  }

  // Notificación + auditoría: best-effort, jamás rompen la activación.
  await createNotification(admin, {
    tenantId: promo.tenant_id,
    profileId: promo.buyer_id,
    kind: "post_promotion",
    category: "publicidad",
    ignorePrefs: true,
    title: "¡Tu campaña ya está activa!",
    body: `Tu publicación llega a toda la comunidad hasta el ${formatDate(endsAt, { style: "long" })}.`,
    href: `/feed/${promo.post_id}`,
  });
  const { error: auditError } = await admin.from("audit_log").insert({
    tenant_id: promo.tenant_id,
    actor_id: promo.buyer_id,
    action: "post_promotion_activated",
    subject_kind: "post_promotion",
    subject_id: promo.id,
    meta: { post_id: promo.post_id, duration_days: promo.duration_days },
  });
  if (auditError) {
    console.error(
      `[pagos:webhook] post_promotion ${promo.id} quedó ACTIVA pero no se pudo auditar — code=${auditError.code}. La activación es válida; falta el rastro.`,
    );
  }
}

/** +25 al Trust Score al verificar identidad (clamp 0-100, una sola vez). */
const IDENTITY_TRUST_BONUS = 25;

/**
 * Identity verificada (§5.4): enciende el flag del perfil, recomputa el
 * Trust Score y avisa. Del documento NO llega ni se persiste NADA.
 *
 * Idempotente: un perfil ya verificado no vuelve a sumar puntos — y el gate no
 * es sólo el `if` sobre la fila leída, sino `identity_verified=false` en el
 * `WHERE` del UPDATE, que es lo que sostiene el caso de dos entregas a la vez
 * (mismo patrón que `activateBoost`).
 */
async function handleIdentityVerified(
  admin: AdminClient,
  session: Stripe.Identity.VerificationSession,
): Promise<void> {
  const userId = metadataString(session.metadata, "user_id");
  if (!userId) {
    console.warn(
      `[pagos:webhook] identity verified ${session.id} sin metadata.user_id — se ignora.`,
    );
    return;
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, tenant_id, identity_verified")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error(`select profiles: ${profileError.code}`);
  if (!profile) {
    console.warn(`[pagos:webhook] identity verified para perfil inexistente — se ignora.`);
    return;
  }
  if (profile.identity_verified) return; // retry o segunda sesión: ya está

  // El `identity_verified: false` va en el `WHERE` por lo mismo que el estado
  // del boost: dos entregas del mismo evento leen las dos el perfil sin
  // verificar y siguen las dos. Con el predicado acá, la segunda no matchea
  // ninguna fila y corta antes de duplicar la notificación y la auditoría.
  const { data: verificados, error: updateError } = await admin
    .from("profiles")
    .update({
      identity_verified: true,
      identity_verified_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .eq("identity_verified", false)
    .select("id");
  if (updateError) throw new Error(`update profiles: ${updateError.code}`);
  if ((verificados ?? []).length === 0) {
    console.warn(
      `[pagos:webhook] identity ${session.id}: el perfil ya había quedado verificado por otra entrega — no se duplica nada.`,
    );
    return;
  }

  // Trust Score: +25 clamp 100 + señal explicable (§4.3 — contadores, no grafo).
  //
  // ⚠️ EL `error` DE ESTE SELECT SE LANZA, NO SE IGNORA. Es un read-modify-write:
  // el upsert de abajo escribe `score` y REEMPLAZA `signals` entero. Un `data`
  // en null por un fallo de lectura es indistinguible de "no tiene fila", así
  // que descartarlo convertía un timeout transitorio en "score 25 y una sola
  // señal" para alguien que venía con 85 y acababa de PAGAR por verificarse:
  // bajaba de nivel justo cuando compró subir, y sin una línea de log. Lanzar
  // deja que el reintento de Stripe lo reprocese entero.
  const { data: trust, error: trustSelectError } = await admin
    .from("trust_scores")
    .select("score, signals")
    .eq("profile_id", userId)
    .maybeSingle();
  if (trustSelectError) throw new Error(`select trust_scores: ${trustSelectError.code}`);
  const signals: Record<string, Json | undefined> =
    trust?.signals && typeof trust.signals === "object" && !Array.isArray(trust.signals)
      ? { ...(trust.signals as Record<string, Json | undefined>) }
      : {};
  const alreadyCounted = signals.identity_verified === true;
  const newScore = alreadyCounted
    ? clampScore(trust?.score ?? 0)
    : clampScore((trust?.score ?? 0) + IDENTITY_TRUST_BONUS);
  signals.identity_verified = true;

  const { error: trustError } = await admin.from("trust_scores").upsert(
    {
      profile_id: userId,
      tenant_id: profile.tenant_id,
      score: newScore,
      level: getTrustLevel(newScore).id,
      signals: signals as Json,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" },
  );
  if (trustError) throw new Error(`upsert trust_scores: ${trustError.code}`);

  // Notificación + auditoría: best-effort.
  await createNotification(admin, {
    tenantId: profile.tenant_id,
    profileId: userId,
    kind: "identity",
    // "cuenta" es una de las tres que no se pueden silenciar: el emisor ni
    // siquiera consulta preferencias (0045).
    category: "cuenta",
    title: "Tu identidad quedó verificada ✓",
    body: "El tilde ya aparece en tu perfil y tu Trust Score subió. Gracias por hacer tu comunidad más segura.",
    href: "/perfil",
    dedupeUnread: true,
  });
  const { error: auditError } = await admin.from("audit_log").insert({
    tenant_id: profile.tenant_id,
    actor_id: userId,
    action: "identity_verified",
    subject_kind: "profile",
    subject_id: userId,
    // §5.4: NADA del documento — solo la fuente del flag.
    meta: { via: "stripe_identity" },
  });
  if (auditError) {
    console.error(
      `[pagos:webhook] identity de ${userId} quedó verificada pero no se pudo auditar — code=${auditError.code}. La verificación es válida; falta el rastro.`,
    );
  }
}

/**
 * Identity requiere reintento (foto movida, documento cortado, etc.):
 * notificación cálida con link para volver a intentar. Nunca un negativo duro.
 */
async function handleIdentityRequiresInput(
  admin: AdminClient,
  session: Stripe.Identity.VerificationSession,
): Promise<void> {
  const userId = metadataString(session.metadata, "user_id");
  if (!userId) return;

  const { data: profile } = await admin
    .from("profiles")
    .select("id, tenant_id, identity_verified")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || profile.identity_verified) return;

  await createNotification(admin, {
    tenantId: profile.tenant_id,
    profileId: userId,
    kind: "identity",
    category: "cuenta",
    // Pide una acción concreta (repetir la foto): entra en "Importantes".
    priority: "high",
    title: "Nos faltó un detalle para verificarte",
    body: "No pudimos leer bien tu documento — pasa seguido con fotos movidas. Probá de nuevo con buena luz; toma menos de un minuto.",
    href: "/perfil/verificar",
    dedupeUnread: true,
  });
}
