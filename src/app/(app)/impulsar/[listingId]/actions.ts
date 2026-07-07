"use server";

import { z } from "zod";
import { isStripeConfigured } from "@/lib/config/services";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { BOOST_PACKAGES, boostMontoCentavos, getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";

/** Copy de errores del módulo — cálido, sin jerga técnica. */
const COPY = {
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  errorNoEsTuyo:
    "Solo el dueño del aviso puede impulsarlo. Si es tuyo, entrá con tu cuenta.",
  errorNoPublicado:
    "El aviso tiene que estar publicado para impulsarlo. Apenas se apruebe, volvé por acá.",
  errorMuchosIntentos:
    "Empezaste varios impulsos seguidos. Esperá un rato y probá de nuevo — tu aviso sigue publicado igual.",
} as const;

/** Rate limit (fiscal R3): cada intento crea una fila + una Checkout Session. */
const BOOST_HOURLY_LIMIT = 5;

const boostSchema = z.object({
  listingId: z.uuid(),
  paquete: z.enum(["7d", "14d", "30d"]),
});

export type CrearBoostCheckoutResult =
  /** Stripe no configurado (HOY): el cliente abre <ProximamentePremium />. */
  | { status: "no_configurado" }
  /** Sin sesión: el cliente redirige a /entrar. */
  | { status: "sin_sesion" }
  | { status: "error"; message: string }
  /** Checkout creado: el cliente navega a la URL de Stripe. */
  | { status: "redirect"; url: string };

/**
 * Crea el Checkout one-time del Boost (PLAN §7, precios [EJEMPLO] §18).
 *
 * Flujo:
 * 1. Ownership PRIMERO, con el cliente del usuario (RLS aplica): el aviso
 *    tiene que ser suyo, de su tenant y estar publicado.
 * 2. Recién entonces se inserta el boost `pending_payment` vía admin
 *    (boosts tiene INSERT en false para authenticated a propósito: el estado
 *    de pago nace y muere en el server).
 * 3. Checkout Session `mode: payment` con metadata.boost_id — el webhook
 *    activa el boost cuando el pago se confirma. Nadie activa el suyo.
 */
export async function crearBoostCheckout(
  input: unknown,
): Promise<CrearBoostCheckoutResult> {
  const parsed = boostSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: COPY.errorGenerico };
  }
  const { listingId, paquete } = parsed.data;
  const tenant = await getTenant();
  const boost = BOOST_PACKAGES[paquete];

  if (!isStripeConfigured) {
    // Degradación elegante §5.6 — se registra el interés para medir demanda.
    console.info(
      `[boost] Intento de impulso con Stripe sin configurar — tenant=${tenant.slug} paquete=${paquete}`,
    );
    return { status: "no_configurado" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "sin_sesion" };

  // Rate limit por usuario ANTES de tocar Stripe/DB: sin esto, un logueado
  // podía generar filas pending_payment + Checkout Sessions sin tope (la
  // purga a 7 días limpia la basura pero no frena el burst).
  if (!limit(`boost:${user.id}`, BOOST_HOURLY_LIMIT, HOUR_MS).ok) {
    return { status: "error", message: COPY.errorMuchosIntentos };
  }

  try {
    // 1. Ownership con RLS del usuario: si no es suyo, para él no existe.
    const { data: listing } = await supabase
      .from("listings")
      .select("id, tenant_id, title, status, created_by, area_label")
      .eq("id", listingId)
      .maybeSingle();

    if (!listing || listing.tenant_id !== tenant.id || listing.created_by !== user.id) {
      return { status: "error", message: COPY.errorNoEsTuyo };
    }
    if (listing.status !== "published") {
      return { status: "error", message: COPY.errorNoPublicado };
    }

    // 2. Boost pending_payment vía admin — GATEADO: ownership verificado arriba.
    const admin = createAdminClient();
    const { data: created, error: insertError } = await admin
      .from("boosts")
      .insert({
        tenant_id: tenant.id,
        listing_id: listing.id,
        buyer_id: user.id,
        package: boost.id,
        duration_days: boost.dias,
        amount_cents: boostMontoCentavos(boost),
        currency: "usd",
        status: "pending_payment",
      })
      .select("id")
      .single();

    if (insertError || !created) {
      console.error(
        `[boost] No se pudo crear el boost — tenant=${tenant.slug} code=${insertError?.code ?? "?"}`,
      );
      return { status: "error", message: COPY.errorGenerico };
    }

    // 3. Checkout one-time. [EJEMPLO] §18: price_data inline; antes del
    // go-live real, migrar a Prices del dashboard de Stripe.
    const stripe = getStripe();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: boostMontoCentavos(boost),
            product_data: {
              name: `Impulso ${boost.nombre} — aviso destacado en tu zona`,
              metadata: { package: boost.id },
            },
          },
        },
      ],
      metadata: {
        boost_id: created.id,
        tenant_id: tenant.id,
        listing_id: listing.id,
      },
      success_url: `${siteUrl}/impulsar/${listing.id}?estado=exito`,
      cancel_url: `${siteUrl}/impulsar/${listing.id}?estado=cancelado`,
    });

    if (!session.url) {
      console.error(
        `[boost] Checkout Session sin URL — tenant=${tenant.slug} boost=${created.id}`,
      );
      return { status: "error", message: COPY.errorGenerico };
    }

    // Vínculo boost↔session — FAIL-HARD (fiscal R3): el webhook exige que la
    // session del evento coincida con esta columna antes de activar. Si el
    // vínculo no se pudo escribir, NO se entrega un checkout pagable huérfano:
    // se expira la session en Stripe, se cancela el boost y se devuelve error.
    const { error: linkError } = await admin
      .from("boosts")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", created.id);
    if (linkError) {
      console.error(
        `[boost] No se pudo vincular la session al boost ${created.id} — code=${linkError.code}. Se expira la session ${session.id}.`,
      );
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (expireError) {
        // Aun si expirar falla, el webhook rechaza la activación por session
        // no coincidente (defensa en profundidad) — solo queda el log.
        console.error(
          `[boost] Tampoco se pudo expirar la session ${session.id}:`,
          expireError instanceof Error ? expireError.message : expireError,
        );
      }
      const { error: cancelError } = await admin
        .from("boosts")
        .update({ status: "canceled" })
        .eq("id", created.id);
      if (cancelError) {
        console.warn(
          `[boost] El boost ${created.id} quedó pending_payment sin session (la purga a 7 días lo limpia) — code=${cancelError.code}`,
        );
      }
      return { status: "error", message: COPY.errorGenerico };
    }

    return { status: "redirect", url: session.url };
  } catch (error) {
    // Nunca un error técnico crudo al usuario (§5.6). Log sin PII.
    console.error(
      `[boost] Error creando Checkout — tenant=${tenant.slug} paquete=${paquete}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY.errorGenerico };
  }
}
