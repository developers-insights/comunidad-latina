import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { isStripeConfigured } from "@/lib/config/services";
import { createNotification } from "@/lib/notifications/notify";
import { PLAN_IDS, getStripe, type PlanId } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
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

      case "checkout.session.async_payment_succeeded": {
        // Pago async (p. ej. transferencia) confirmado después del completed.
        const session = event.data.object as Stripe.Checkout.Session;
        const boostId = metadataString(session.metadata, "boost_id");
        if (boostId) await activateBoost(admin, boostId, session);
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

// ---------------------------------------------------------------------------
// Handlers — cortos y puntuales; lanzan para que el retry de Stripe reprocese
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

/** Ruta de detalle por vertical — para el href de la notificación de boost. */
const LISTING_DETAIL_PATH: Record<string, string> = {
  property: "/propiedades",
  professional: "/profesionales",
  event: "/eventos",
};

/**
 * Activa un boost pagado (§7): status active + ventana [now, now + días].
 * Idempotente: si ya está activo (retry de Stripe), no hace nada.
 *
 * CORRELACIÓN OBLIGATORIA (fiscal R3): la metadata sola no alcanza — antes de
 * activar se exige que (a) el boost siga `pending_payment` (un
 * async_payment_succeeded tardío NO re-activa un boost que un admin canceló o
 * que ya expiró), (b) la session del evento sea EXACTAMENTE la vinculada en
 * crearBoostCheckout (una session vieja de un retry de checkout no activa), y
 * (c) el monto cobrado coincida con el del boost. Discrepancia → log de
 * alerta + NO activar (sin throw: reintentar no lo arregla; el payload queda
 * en payment_events para reconciliar a mano).
 */
async function activateBoost(
  admin: AdminClient,
  boostId: string,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const { data: boost, error: selectError } = await admin
    .from("boosts")
    .select(
      "id, tenant_id, listing_id, buyer_id, duration_days, status, amount_cents, stripe_checkout_session_id, listings(kind)",
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
  if (session.amount_total !== boost.amount_cents) {
    console.error(
      `[pagos:webhook] ALERTA boost ${boostId}: amount_total ${session.amount_total ?? "null"} ≠ esperado ${boost.amount_cents} — NO se activa.`,
    );
    return;
  }

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + boost.duration_days * 86_400_000);

  const { error: updateError } = await admin
    .from("boosts")
    .update({
      status: "active",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq("id", boost.id);
  if (updateError) throw new Error(`update boosts: ${updateError.code}`);

  // Notificación + auditoría: best-effort, jamás rompen la activación.
  const detailBase = LISTING_DETAIL_PATH[boost.listings?.kind ?? ""];
  await createNotification(admin, {
    tenantId: boost.tenant_id,
    profileId: boost.buyer_id,
    kind: "boost",
    title: "¡Tu aviso ya está destacado!",
    body: `Aparece primero en tu zona, marcado como "Destacado", hasta el ${formatDate(endsAt, { style: "long" })}.`,
    href: detailBase ? `${detailBase}/${boost.listing_id}` : null,
  });
  await admin.from("audit_log").insert({
    tenant_id: boost.tenant_id,
    actor_id: boost.buyer_id,
    action: "boost_activated",
    subject_kind: "boost",
    subject_id: boost.id,
    meta: { listing_id: boost.listing_id, duration_days: boost.duration_days },
  });
}

/** +25 al Trust Score al verificar identidad (clamp 0-100, una sola vez). */
const IDENTITY_TRUST_BONUS = 25;

/**
 * Identity verificada (§5.4): enciende el flag del perfil, recomputa el
 * Trust Score y avisa. Del documento NO llega ni se persiste NADA.
 * Idempotente: un perfil ya verificado no vuelve a sumar puntos.
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

  const { error: updateError } = await admin
    .from("profiles")
    .update({
      identity_verified: true,
      identity_verified_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (updateError) throw new Error(`update profiles: ${updateError.code}`);

  // Trust Score: +25 clamp 100 + señal explicable (§4.3 — contadores, no grafo).
  const { data: trust } = await admin
    .from("trust_scores")
    .select("score, signals")
    .eq("profile_id", userId)
    .maybeSingle();
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
    title: "Tu identidad quedó verificada ✓",
    body: "El tilde ya aparece en tu perfil y tu Trust Score subió. Gracias por hacer tu comunidad más segura.",
    href: "/perfil",
    dedupeUnread: true,
  });
  await admin.from("audit_log").insert({
    tenant_id: profile.tenant_id,
    actor_id: userId,
    action: "identity_verified",
    subject_kind: "profile",
    subject_id: userId,
    // §5.4: NADA del documento — solo la fuente del flag.
    meta: { via: "stripe_identity" },
  });
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
    title: "Nos faltó un detalle para verificarte",
    body: "No pudimos leer bien tu documento — pasa seguido con fotos movidas. Probá de nuevo con buena luz; toma menos de un minuto.",
    href: "/perfil/verificar",
    dedupeUnread: true,
  });
}
