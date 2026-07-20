"use server";

import { z } from "zod";
import { isStripeConfigured } from "@/lib/config/services";
import { createNotification } from "@/lib/notifications/notify";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import {
  POST_PROMO_PACKAGES,
  getStripe,
  postPromoMontoCentavos,
} from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types/database.types";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getTenant } from "@/lib/tenant/resolve";
import { formatDate } from "@/lib/utils";

/**
 * Campaña paga de un post (feedback cliente 2026-07-19) — espejo de boosts
 * (src/app/(app)/impulsar/[listingId]/actions.ts).
 *
 * Diferencia deliberada con boosts: SIN Stripe configurado, la campaña corre en
 * MODO DEMO (post_promotions active directo vía admin, etiquetado en la UI) para
 * poder validar el modelo antes del go-live. CON Stripe, el patrón exacto del
 * boost: fila pending_payment + Checkout one-time + activación por webhook.
 *
 * En ambos casos: guard de tenant + ownership del post ANTES de cualquier
 * efecto colateral, y post_promotions.status lo escribe SOLO el server
 * (RLS write=false para usuarios: admin client o webhook).
 */

const COPY = {
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  errorNoEsTuyo:
    "Solo quien publicó el post puede promocionarlo. Si es tuyo, entrá con tu cuenta.",
  errorNoPublicado:
    "El post tiene que estar publicado para promocionarlo. Apenas se apruebe, volvé por acá.",
  errorYaActiva:
    "Este post ya tiene una campaña activa. Cuando termine, podés lanzar otra desde acá.",
  errorMuchosIntentos:
    "Empezaste varias campañas seguidas. Esperá un rato y probá de nuevo — tu post sigue publicado igual.",
} as const;

/** Rate limit: cada intento crea una fila (+ Checkout Session con Stripe). */
const PROMO_HOURLY_LIMIT = 5;

const audienceSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }),
  z.object({
    scope: z.literal("zones"),
    zones: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  }),
]);

const campanaSchema = z.object({
  postId: z.uuid(),
  paquete: z.enum(["7d", "14d", "30d"]),
  audience: audienceSchema,
});

export type CrearCampanaResult =
  /** Modo demo (sin Stripe): la campaña quedó activa ya mismo. */
  | { status: "demo_activada"; endsAt: string }
  /** Sin sesión: el cliente redirige a /entrar. */
  | { status: "sin_sesion" }
  | { status: "error"; message: string }
  /** Checkout creado: el cliente navega a la URL de Stripe. */
  | { status: "redirect"; url: string };

export async function crearCampanaPost(
  input: unknown,
): Promise<CrearCampanaResult> {
  const parsed = campanaSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: COPY.errorGenerico };
  }
  const { postId, paquete, audience } = parsed.data;
  const tenant = await getTenant();
  const promo = POST_PROMO_PACKAGES[paquete];

  // Guard ANTES del rate limit y del ownership: con el tenant del header
  // divergente, el chequeo de abajo daría "no es tuyo" sobre un post que SÍ es
  // del usuario, y le quemaría el cupo horario por un intento imposible.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { supabase, user } = guard;

  if (!limit(`postpromo:${user.id}`, PROMO_HOURLY_LIMIT, HOUR_MS).ok) {
    return { status: "error", message: COPY.errorMuchosIntentos };
  }

  const audienceJson = audience as unknown as Json;

  try {
    // 1. Ownership con RLS del usuario: si no es suyo, para él no existe.
    const { data: post } = await supabase
      .from("posts")
      .select("id, tenant_id, author_id, status")
      .eq("id", postId)
      .maybeSingle();

    if (!post || post.tenant_id !== tenant.id || post.author_id !== user.id) {
      return { status: "error", message: COPY.errorNoEsTuyo };
    }
    if (post.status !== "published") {
      return { status: "error", message: COPY.errorNoPublicado };
    }

    // 2. Ya hay campaña activa vigente → no duplicar (el server es la fuente).
    const { data: activa } = await supabase
      .from("post_promotions")
      .select("id")
      .eq("post_id", post.id)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (activa) {
      return { status: "error", message: COPY.errorYaActiva };
    }

    const admin = createAdminClient();

    // 3a. MODO DEMO (Stripe sin configurar): activación directa, sin cobro.
    if (!isStripeConfigured) {
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + promo.dias * 86_400_000);
      const { data: created, error: insertError } = await admin
        .from("post_promotions")
        .insert({
          tenant_id: tenant.id,
          post_id: post.id,
          buyer_id: user.id,
          package: promo.id,
          duration_days: promo.dias,
          amount_cents: postPromoMontoCentavos(promo),
          currency: "usd",
          audience: audienceJson,
          status: "active",
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
        })
        .select("id")
        .single();

      if (insertError || !created) {
        console.error(
          `[post-promo] No se pudo activar la campaña demo — tenant=${tenant.slug} code=${insertError?.code ?? "?"}`,
        );
        return { status: "error", message: COPY.errorGenerico };
      }

      // Notificación + auditoría best-effort (jamás rompen la activación).
      await createNotification(admin, {
        tenantId: tenant.id,
        profileId: user.id,
        kind: "post_promotion",
        title: "¡Tu campaña ya está activa!",
        body: `Tu publicación llega a toda la comunidad hasta el ${formatDate(endsAt, { style: "long" })}. (Modo demostración)`,
        href: `/feed/${post.id}`,
      });
      await admin.from("audit_log").insert({
        tenant_id: tenant.id,
        actor_id: user.id,
        action: "post_promotion_activated_demo",
        subject_kind: "post_promotion",
        subject_id: created.id,
        meta: { post_id: post.id, duration_days: promo.dias, mode: "demo" },
      });

      return { status: "demo_activada", endsAt: endsAt.toISOString() };
    }

    // 3b. CON Stripe: fila pending_payment vía admin (RLS write=false a propósito).
    const { data: created, error: insertError } = await admin
      .from("post_promotions")
      .insert({
        tenant_id: tenant.id,
        post_id: post.id,
        buyer_id: user.id,
        package: promo.id,
        duration_days: promo.dias,
        amount_cents: postPromoMontoCentavos(promo),
        currency: "usd",
        audience: audienceJson,
        status: "pending_payment",
      })
      .select("id")
      .single();

    if (insertError || !created) {
      console.error(
        `[post-promo] No se pudo crear la campaña — tenant=${tenant.slug} code=${insertError?.code ?? "?"}`,
      );
      return { status: "error", message: COPY.errorGenerico };
    }

    // 4. Checkout one-time. [EJEMPLO] §18: price_data inline (mismo patrón boost).
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
            unit_amount: postPromoMontoCentavos(promo),
            product_data: {
              name: `Promoción ${promo.nombre} — tu publicación llega a toda la comunidad`,
              metadata: { package: promo.id },
            },
          },
        },
      ],
      metadata: {
        post_promotion_id: created.id,
        tenant_id: tenant.id,
        post_id: post.id,
      },
      success_url: `${siteUrl}/impulsar-post/${post.id}?estado=exito`,
      cancel_url: `${siteUrl}/impulsar-post/${post.id}?estado=cancelado`,
    });

    if (!session.url) {
      console.error(
        `[post-promo] Checkout Session sin URL — tenant=${tenant.slug} campaña=${created.id}`,
      );
      return { status: "error", message: COPY.errorGenerico };
    }

    // Vínculo campaña↔session — FAIL-HARD (igual que boosts): el webhook exige
    // que la session del evento coincida con esta columna antes de activar. Si
    // el vínculo no se pudo escribir, NO se entrega un checkout pagable
    // huérfano: se expira la session, se cancela la campaña y se devuelve error.
    const { error: linkError } = await admin
      .from("post_promotions")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", created.id);
    if (linkError) {
      console.error(
        `[post-promo] No se pudo vincular la session a la campaña ${created.id} — code=${linkError.code}. Se expira ${session.id}.`,
      );
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (expireError) {
        console.error(
          `[post-promo] Tampoco se pudo expirar la session ${session.id}:`,
          expireError instanceof Error ? expireError.message : expireError,
        );
      }
      const { error: cancelError } = await admin
        .from("post_promotions")
        .update({ status: "canceled" })
        .eq("id", created.id);
      if (cancelError) {
        console.warn(
          `[post-promo] La campaña ${created.id} quedó pending_payment sin session (la purga a 7 días la limpia) — code=${cancelError.code}`,
        );
      }
      return { status: "error", message: COPY.errorGenerico };
    }

    return { status: "redirect", url: session.url };
  } catch (error) {
    console.error(
      `[post-promo] Error creando campaña — tenant=${tenant.slug} paquete=${paquete}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY.errorGenerico };
  }
}
