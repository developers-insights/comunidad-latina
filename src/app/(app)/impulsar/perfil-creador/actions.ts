"use server";

import { z } from "zod";
import { isStripeConfigured } from "@/lib/config/services";
import { getPrice } from "@/lib/pricing/read";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { BOOST_PACKAGES, getStripe } from "@/lib/stripe";
import { crearCheckoutSession } from "@/lib/stripe/checkout";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getTenant } from "@/lib/tenant/resolve";
import { impulsoVigente, situacionDelCreador } from "./modelo";

const COPY = {
  errorGenerico:
    "Algo no salió bien de nuestro lado, no es tu culpa. Probá de nuevo en un momento.",
  noAprobado:
    "Para promocionar tu perfil primero tenés que ser creador aprobado en esta comunidad.",
  yaActivo:
    "Tu perfil ya está promocionado. Cuando termine, vas a poder volver a promocionarlo desde acá.",
  muchosIntentos: "Empezaste varios pagos seguidos. Esperá un rato y probá de nuevo.",
} as const;

const HORARIO = 5;

const schema = z.object({ paquete: z.enum(["7d", "14d", "30d"]) });

export type CrearImpulsoDePerfilResult =
  | { status: "no_configurado" }
  | { status: "sin_sesion" }
  | { status: "error"; message: string }
  | { status: "redirect"; url: string };

export async function crearImpulsoDePerfilCheckout(
  input: unknown,
): Promise<CrearImpulsoDePerfilResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { status: "error", message: COPY.errorGenerico };
  const { paquete } = parsed.data;
  const tenant = await getTenant();
  const boost = BOOST_PACKAGES[paquete];

  if (!isStripeConfigured) {
    console.info(
      `[impulso-perfil] Intento con Stripe sin configurar — tenant=${tenant.slug} paquete=${paquete}`,
    );
    return { status: "no_configurado" };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { supabase, user } = guard;

  if (!limit(`impulso-perfil:${user.id}`, HORARIO, HOUR_MS).ok) {
    return { status: "error", message: COPY.muchosIntentos };
  }

  try {
    const [{ data: perfil }, { data: vigentes }] = await Promise.all([
      supabase
        .from("creator_profiles")
        .select("profile_id, tenant_id, status")
        .eq("profile_id", user.id)
        .maybeSingle(),
      supabase
        .from("creator_profile_boosts")
        .select("status, ends_at")
        .eq("creator_id", user.id)
        .eq("tenant_id", tenant.id)
        .eq("status", "active")
        .gt("ends_at", new Date().toISOString())
        .limit(1),
    ]);

    if (
      !perfil ||
      perfil.tenant_id !== tenant.id ||
      situacionDelCreador(perfil.status) !== "aprobado"
    ) {
      return { status: "error", message: COPY.noAprobado };
    }
    if (impulsoVigente(vigentes ?? [], new Date().getTime())) {
      return { status: "error", message: COPY.yaActivo };
    }

    // Mismo precio que el impulso de aviso de igual duración: es la fila que la
    // comunidad ya configura en su panel, y la pantalla la lee con la misma
    // función, así que lo que se muestra es lo que se cobra.
    const precio = await getPrice(supabase, tenant.id, "boost", paquete, "unico");
    if (!precio) {
      console.error(`[impulso-perfil] Sin precio para boost/${paquete} — tenant=${tenant.slug}`);
      return { status: "error", message: COPY.errorGenerico };
    }
    const currency = precio.currency.toLowerCase();

    const admin = createAdminClient();
    const { data: created, error: insertError } = await admin
      .from("creator_profile_boosts")
      .insert({
        tenant_id: tenant.id,
        creator_id: user.id,
        package: boost.id,
        duration_days: boost.dias,
        amount_cents: precio.amountCents,
        currency,
        status: "pending_payment",
      })
      .select("id")
      .single();

    if (insertError || !created) {
      console.error(
        `[impulso-perfil] No se pudo crear el impulso — tenant=${tenant.slug} code=${insertError?.code ?? "?"}`,
      );
      return { status: "error", message: COPY.errorGenerico };
    }

    const stripe = getStripe();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const session = await crearCheckoutSession({
      mode: "payment",
      customer_email: user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: precio.amountCents,
            product_data: {
              name: `Perfil de creador patrocinado · ${boost.nombre}`,
              metadata: { package: boost.id, kind: "creator_profile" },
            },
          },
        },
      ],
      metadata: {
        creator_profile_boost_id: created.id,
        tenant_id: tenant.id,
        creator_id: user.id,
      },
      success_url: `${siteUrl}/impulsar/perfil-creador?estado=exito`,
      cancel_url: `${siteUrl}/impulsar/perfil-creador?estado=cancelado`,
    });

    if (!session.url) {
      console.error(`[impulso-perfil] Checkout sin URL — impulso=${created.id}`);
      return { status: "error", message: COPY.errorGenerico };
    }

    // El webhook exige que la sesión del evento sea la vinculada acá: sin
    // vínculo no se entrega un checkout pagable que nunca podría activarse.
    const { error: linkError } = await admin
      .from("creator_profile_boosts")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", created.id);
    if (linkError) {
      console.error(
        `[impulso-perfil] No se pudo vincular la sesión ${session.id} al impulso ${created.id} — code=${linkError.code}. Se expira.`,
      );
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (expireError) {
        console.error(
          `[impulso-perfil] Tampoco se pudo expirar la sesión ${session.id}:`,
          expireError instanceof Error ? expireError.message : expireError,
        );
      }
      const { error: cancelError } = await admin
        .from("creator_profile_boosts")
        .update({ status: "canceled" })
        .eq("id", created.id);
      if (cancelError) {
        console.warn(
          `[impulso-perfil] El impulso ${created.id} quedó pending_payment sin sesión — code=${cancelError.code}`,
        );
      }
      return { status: "error", message: COPY.errorGenerico };
    }

    return { status: "redirect", url: session.url };
  } catch (error) {
    console.error(
      `[impulso-perfil] Error creando el Checkout — tenant=${tenant.slug} paquete=${paquete}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY.errorGenerico };
  }
}
