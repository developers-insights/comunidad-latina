"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isPagosDemoPermitido, isStripeConfigured } from "@/lib/config/services";
import { createNotification } from "@/lib/notifications/notify";
import { getPrice } from "@/lib/pricing/read";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { POST_PROMO_PACKAGES, getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types/database.types";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";

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
  // "publicación", nunca "post": es la palabra que usa el resto de la app (el
  // feed, y el `postLabel` de la página que abre esta acción). Además "post" es
  // inglés, y quien lee estos mensajes es una familia latina, no un dev.
  errorNoEsTuyo:
    "Esta publicación no es tuya, así que no podés promocionarla. Si es tuya, entrá con tu cuenta.",
  errorNoPublicado:
    "Tu publicación todavía no está en línea. Apenas el equipo de tu comunidad la apruebe, volvé por acá.",
  errorYaActiva:
    "Esta publicación ya tiene una campaña activa. Cuando termine, podés lanzar otra desde acá.",
  errorMuchosIntentos:
    "Empezaste varias campañas seguidas. Esperá un rato y probá de nuevo — tu publicación sigue en su lugar.",
  errorWhatsapp:
    "Revisá el WhatsApp: escribí el número completo con código de país, por ejemplo +1 305 555 0134.",
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

/**
 * Teléfono OPCIONAL del botón de WhatsApp de la campaña (post_promotions.
 * cta_whatsapp, 0038). Se limpia a "+dígitos" y se acepta con 8 a 15 dígitos
 * (el rango de E.164): así el anunciante lo escribe como quiera
 * ("+1 (305) 555-0134") y se guarda normalizado. Vacío → null: la campaña
 * simplemente no ofrece WhatsApp.
 */
const ctaWhatsappSchema = z
  .string()
  .max(40)
  .optional()
  .nullable()
  .transform((raw) => {
    if (!raw) return "";
    const digitos = raw.replace(/\D/g, "");
    return raw.trim().startsWith("+") ? `+${digitos}` : digitos;
  })
  .refine((valor) => valor === "" || /^\+?\d{8,15}$/.test(valor))
  .transform((valor) => (valor === "" ? null : valor));

const campanaSchema = z.object({
  postId: z.uuid(),
  paquete: z.enum(["7d", "14d", "30d"]),
  audience: audienceSchema,
  ctaWhatsapp: ctaWhatsappSchema,
});

export type CrearCampanaResult =
  /** Modo demo (sin Stripe y SIN deploy de por medio): la campaña quedó activa ya mismo. */
  | { status: "demo_activada"; endsAt: string }
  /**
   * Sin Stripe, pero publicado: el cliente muestra `<ProximamentePremium>`, igual
   * que los otros seis productos. Ver `isPagosDemoPermitido` en
   * `lib/config/services.ts` para el porqué de la diferencia.
   */
  | { status: "no_configurado" }
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
    // El único campo que el usuario puede escribir mal es el WhatsApp: si el
    // rechazo vino de ahí se lo decimos, en vez de culpar a "nuestro lado".
    const esTelefono = parsed.error.issues.some(
      (issue) => issue.path[0] === "ctaWhatsapp",
    );
    return {
      status: "error",
      message: esTelefono ? COPY.errorWhatsapp : COPY.errorGenerico,
    };
  }
  const { postId, paquete, audience, ctaWhatsapp } = parsed.data;
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

  // EL PRECIO DE LA COMUNIDAD (`tenant_prices`, 0072) — la misma lectura que
  // pintó las tarjetas en /impulsar-post/[postId]. Se resuelve UNA vez y sirve
  // para los DOS caminos: el modo demo (que no cobra pero deja asentado cuánto
  // habría costado) y el Checkout real, donde `post_promotions.amount_cents` y
  // el `unit_amount` de Stripe tienen que coincidir o el webhook no activa.
  const precio = await getPrice(supabase, tenant.id, "post_promo", paquete, "unico");
  if (!precio) {
    console.error(`[post-promo] Sin precio para post_promo/${paquete} — tenant=${tenant.slug}`);
    return { status: "error", message: COPY.errorGenerico };
  }
  const currency = precio.currency.toLowerCase();

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
    // cta_whatsapp llega con la 0038 y todavía no está en database.types.ts →
    // los dos inserts de la campaña van por un cliente de schema abierto (mismo
    // patrón que assistant_queries). El resto del archivo sigue tipado.
    const adminOpen = admin as unknown as SupabaseClient;

    // 3a. SIN STRIPE Y PUBLICADO: se degrada como los otros seis productos.
    //
    // Este camino ANTES no existía: la única condición era `!isStripeConfigured`
    // y caía derecho al modo demo de abajo. O sea que producción sin
    // `STRIPE_SECRET_KEY` —una variable borrada, un env mal armado, una rotación
    // a medias— le REGALABA la campaña a cualquiera, con notificación de éxito y
    // fila de auditoría, sin un solo error en los logs. Ver
    // `isPagosDemoPermitido` en `lib/config/services.ts`.
    if (!isStripeConfigured && !isPagosDemoPermitido) {
      console.error(
        `[post-promo] Stripe sin configurar en un entorno PUBLICADO — tenant=${tenant.slug}. No se activa nada y la persona ve "muy pronto". Cargar STRIPE_SECRET_KEY.`,
      );
      return { status: "no_configurado" };
    }

    // 3b. MODO DEMO (sin Stripe y sin deploy): activación directa, sin cobro.
    if (isPagosDemoPermitido) {
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + promo.dias * 86_400_000);
      const { data: created, error: insertError } = await adminOpen
        .from("post_promotions")
        .insert({
          tenant_id: tenant.id,
          post_id: post.id,
          buyer_id: user.id,
          package: promo.id,
          duration_days: promo.dias,
          amount_cents: precio.amountCents,
          currency,
          audience: audienceJson,
          cta_whatsapp: ctaWhatsapp,
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
        category: "publicidad",
        // `ignorePrefs`: es el resultado de algo que la persona acaba de hacer
        // (activar su propia campaña). Haber silenciado "Publicidad" significa
        // "no me avises de promociones", no "no me cuentes cómo salió lo que
        // pedí hace diez segundos".
        ignorePrefs: true,
        title: "¡Tu campaña ya está activa!",
        // El aviso es para QUIEN acaba de activar la campaña (`profileId:
        // user.id`), así que la fecha va con su reloj. Queda congelada en el
        // texto de la notificación: si después cambia de zona, este aviso viejo
        // sigue diciendo lo que decía — y eso es correcto, era el día que leyó.
        body: `Tu publicación llega a toda la comunidad hasta el ${(await getViewerFormatDate())(endsAt, { style: "long" })}. (Modo demostración)`,
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

    // 3c. CON Stripe: fila pending_payment vía admin (RLS write=false a propósito).
    const { data: created, error: insertError } = await adminOpen
      .from("post_promotions")
      .insert({
        tenant_id: tenant.id,
        post_id: post.id,
        buyer_id: user.id,
        package: promo.id,
        duration_days: promo.dias,
        amount_cents: precio.amountCents,
        currency,
        audience: audienceJson,
        cta_whatsapp: ctaWhatsapp,
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

    // 4. Checkout one-time con el precio vigente de la comunidad (mismo patrón
    //    que el boost: el mismo entero que quedó en la fila viaja a Stripe).
    const stripe = getStripe();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            // Moneda explícita de `tenant_prices`, en minúsculas para Stripe.
            currency,
            unit_amount: precio.amountCents,
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
