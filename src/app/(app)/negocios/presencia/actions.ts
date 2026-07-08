"use server";

import { z } from "zod";
import { isStripeConfigured } from "@/lib/config/services";
import {
  getStripe,
  montoCentavos,
  PLANES_PRESENCIA,
} from "@/lib/stripe";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getTenant } from "@/lib/tenant/resolve";

/** Copy de errores del módulo — cálido, sin jerga técnica. */
const COPY = {
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  errorSinNegocio:
    "No pudimos preparar tu cuenta de negocio. Probá de nuevo en un momento.",
} as const;

const suscripcionSchema = z.object({
  plan: z.enum(["basico", "destacado", "pro"]),
  intervalo: z.enum(["mensual", "anual"]),
});

export type IniciarSuscripcionResult =
  /** Stripe no configurado (HOY): el cliente abre <ProximamentePremium />. */
  | { status: "no_configurado" }
  /** Sin sesión: el cliente redirige a /entrar. */
  | { status: "sin_sesion" }
  | { status: "error"; message: string }
  /** Checkout creado: el cliente navega a la URL de Stripe. */
  | { status: "redirect"; url: string };

/**
 * Inicia la suscripción de Presencia Verificada (PLAN §7).
 *
 * HOY (Stripe sin configurar): loguea el intento en server (console.info,
 * sin PII — solo tenant/plan) y devuelve `no_configurado` para que la UI
 * degrade elegante. El código de Checkout queda completo y listo para
 * cuando exista STRIPE_SECRET_KEY.
 */
export async function iniciarSuscripcion(
  input: unknown,
): Promise<IniciarSuscripcionResult> {
  const parsed = suscripcionSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: COPY.errorGenerico };
  }
  const { plan: planId, intervalo } = parsed.data;
  const tenant = await getTenant();

  if (!isStripeConfigured) {
    // Degradación elegante §5.6 — se registra el interés para medir demanda.
    // Sin PII: solo tenant, plan e intervalo. (Sin insert a audit_log: este
    // módulo no tiene permiso de escritura ahí.)
    console.info(
      `[pagos] Intento de suscripción con Stripe sin configurar — tenant=${tenant.slug} plan=${planId} intervalo=${intervalo}`,
    );
    return { status: "no_configurado" };
  }

  // Guard antes de crear la business_account y antes de abrir el Checkout: sin
  // coincidencia de tenant la RLS rechaza el insert y quedaría una Session
  // pagable sin cuenta detrás.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { supabase, user } = guard;

  const plan = PLANES_PRESENCIA[planId];

  try {
    // Cuenta de negocio del dueño en este tenant (RLS aplica: solo la propia).
    const { data: existing } = await supabase
      .from("business_accounts")
      .select("id, name, stripe_customer_id")
      .eq("owner_id", user.id)
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    let businessAccountId = existing?.id ?? null;
    if (!businessAccountId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();

      const { data: created, error: insertError } = await supabase
        .from("business_accounts")
        .insert({
          tenant_id: tenant.id,
          owner_id: user.id,
          name: profile?.display_name ?? "Mi negocio",
        })
        .select("id")
        .single();

      if (insertError || !created) {
        console.error(
          `[pagos] No se pudo crear business_account — tenant=${tenant.slug} code=${insertError?.code ?? "?"}`,
        );
        return { status: "error", message: COPY.errorSinNegocio };
      }
      businessAccountId = created.id;
    }

    const stripe = getStripe();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const metadata = {
      tenant_id: tenant.id,
      business_account_id: businessAccountId,
      plan: plan.id,
      intervalo,
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Si ya es customer, reusar; si no, Stripe crea uno con el email.
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: user.email }),
      line_items: [
        {
          quantity: 1,
          // [EJEMPLO] §18: price_data inline con los montos de PLANES_PRESENCIA.
          // Antes del go-live real, migrar a Prices del dashboard de Stripe.
          price_data: {
            currency: "usd",
            unit_amount: montoCentavos(plan, intervalo),
            recurring: { interval: intervalo === "anual" ? "year" : "month" },
            product_data: {
              name: `Presencia Verificada — Plan ${plan.nombre}`,
              metadata: { plan: plan.id },
            },
          },
        },
      ],
      metadata,
      subscription_data: { metadata },
      success_url: `${siteUrl}/negocios/presencia?estado=exito`,
      cancel_url: `${siteUrl}/negocios/presencia?estado=cancelado`,
    });

    if (!session.url) {
      console.error(
        `[pagos] Checkout Session sin URL — tenant=${tenant.slug} plan=${planId}`,
      );
      return { status: "error", message: COPY.errorGenerico };
    }
    return { status: "redirect", url: session.url };
  } catch (error) {
    // Nunca un error técnico crudo al usuario (§5.6). Log sin PII.
    console.error(
      `[pagos] Error creando Checkout Session — tenant=${tenant.slug} plan=${planId}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY.errorGenerico };
  }
}
