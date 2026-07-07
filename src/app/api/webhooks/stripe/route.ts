import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { isStripeConfigured } from "@/lib/config/services";
import { PLAN_IDS, getStripe, type PlanId } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types/database.types";

/**
 * Webhook de Stripe — Presencia Verificada (PLAN §7, ARQUITECTURA §9).
 *
 * ⚠️ FIRMA HUMANA SENIOR REQUERIDA antes de producción (PLAN §14.4):
 * este endpoint escribe con service-role (bypassa RLS) y activa planes
 * pagos. Nadie lo apunta a claves live sin pentest + revisión humana.
 *
 * Garantías:
 * - Firma verificada con `constructEvent` sobre el body CRUDO (req.text()).
 * - Idempotencia: `payment_events.event_id` es UNIQUE — un reintento de
 *   Stripe con un evento ya procesado devuelve 200 sin reprocesar.
 * - Respuesta 2xx rápida (<200ms objetivo): solo 1-2 writes puntuales por
 *   evento; nada de trabajo pesado inline.
 * - Stripe sin configurar → 503 con log (degradación §5.6, nunca crash).
 */

export const runtime = "nodejs";

/** Estados de suscripción de Stripe que mantienen la presencia activa. */
const ACTIVE_SUB_STATUSES: ReadonlyArray<Stripe.Subscription.Status> = [
  "active",
  "trialing",
];

function metadataString(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

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
  const { error: insertError } = await admin.from("payment_events").insert({
    provider: "stripe",
    event_id: event.id,
    event_type: event.type,
    payload: JSON.parse(rawBody) as Json,
    tenant_id: tenantId,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      // Reintento de Stripe: solo reprocesar si el intento anterior falló.
      const { data: previo } = await admin
        .from("payment_events")
        .select("processed")
        .eq("provider", "stripe")
        .eq("event_id", event.id)
        .maybeSingle();
      if (previo?.processed) {
        return NextResponse.json({ received: true, duplicated: true });
      }
      // processed=false → el intento anterior murió a mitad: seguimos.
    } else {
      console.error(
        `[pagos:webhook] No se pudo registrar payment_event ${event.id} — code=${insertError.code}`,
      );
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  }

  // 3. Procesamiento — corto y puntual para responder 2xx rápido.
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const businessAccountId = metadataString(
          session.metadata,
          "business_account_id",
        );
        const plan = metadataPlan(session.metadata);
        if (!businessAccountId || !plan) {
          console.warn(
            `[pagos:webhook] checkout.session.completed ${event.id} sin metadata válida de business_account/plan — se ignora.`,
          );
          break;
        }
        const { error } = await admin
          .from("business_accounts")
          .update({
            plan,
            plan_status: "active",
            stripe_customer_id:
              typeof session.customer === "string"
                ? session.customer
                : (session.customer?.id ?? null),
            stripe_subscription_id:
              typeof session.subscription === "string"
                ? session.subscription
                : (session.subscription?.id ?? null),
            verified_presence: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", businessAccountId);
        if (error) throw new Error(`update business_accounts: ${error.code}`);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const activa = ACTIVE_SUB_STATUSES.includes(subscription.status);
        const plan = metadataPlan(subscription.metadata);
        const { error } = await admin
          .from("business_accounts")
          .update({
            ...(plan ? { plan } : {}),
            plan_status: subscription.status,
            verified_presence: activa,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);
        if (error) throw new Error(`update business_accounts: ${error.code}`);
        break;
      }

      case "customer.subscription.deleted": {
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
