"use server";

import { z } from "zod";
import { isStripeConfigured } from "@/lib/config/services";
import { getPrice } from "@/lib/pricing/read";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { crearCheckoutSession } from "@/lib/stripe/checkout";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { COPY } from "@/components/marketplace/copy";

/**
 * =============================================================================
 * MEMBRESÍA DE TIENDA — alta y baja (spec §7)
 * =============================================================================
 *
 * Lo que esta action SÍ hace: verifica que quien pide sea el dueño de esa
 * tienda y abre la Checkout Session de Stripe (o la de portal para cancelar).
 *
 * Lo que esta action NUNCA hace: escribir `store_memberships`. Las tres
 * policies de escritura de esa tabla están en `false` (0048) — la fila la crea
 * y la mueve SOLO el webhook de Stripe con service_role. Es la misma doctrina
 * que `boosts` (0016): nadie se activa a sí mismo el estado por el que paga.
 * Si esta action insertara la fila, cualquiera con la sesión abierta tendría
 * una tienda gratis con solo llamar al endpoint.
 *
 * Sin Stripe configurado (HOY): se loguea el intento sin PII y se devuelve
 * `no_configurado` para que la UI abra `<ProximamentePremium>` (§5.6). El
 * código de Checkout queda completo y listo para el día que exista la clave.
 */

const activarSchema = z.object({ storeId: z.uuid() });

export type MembresiaResult =
  /** Stripe sin configurar: el cliente abre <ProximamentePremium />. */
  | { status: "no_configurado" }
  /** Sin sesión: el cliente redirige a /entrar. */
  | { status: "sin_sesion" }
  | { status: "error"; message: string }
  /** Checkout/portal creado: el cliente navega a la URL de Stripe. */
  | { status: "redirect"; url: string };

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/**
 * Abre el Checkout de la membresía (USD 10/mes) para UNA tienda del usuario.
 *
 * La tienda es un `listing kind='business'`; se exige `created_by = user.id`
 * ANTES de tocar Stripe, porque una Session pagable sobre una tienda ajena es
 * plata cobrada por algo que después el webhook no va a poder activar.
 */
export async function activarMembresiaTienda(input: unknown): Promise<MembresiaResult> {
  const parsed = activarSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: COPY.membership.errors.generic };
  }
  const { storeId } = parsed.data;

  // Guard PRIMERO: sin coincidencia de tenant no hay nada que cobrar (regla de
  // uso de requireTenantMatch — antes de cualquier efecto colateral).
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // La tienda tiene que ser suya. RLS ya limita qué filas ve, pero el `.eq` de
  // ownership es explícito: es una decisión de plata, no se deduce.
  const { data: store, error: storeError } = await supabase
    .from("listings")
    .select("id, title, created_by, store_active")
    .eq("id", storeId)
    .eq("tenant_id", tenant.id)
    .eq("kind", "business")
    .eq("created_by", user.id)
    .maybeSingle();

  if (storeError) {
    console.warn("[marketplace:membresia] lectura de tienda falló", {
      code: storeError.code,
    });
    return { status: "error", message: COPY.membership.errors.generic };
  }
  if (!store) {
    return { status: "error", message: COPY.membership.errors.notYours };
  }

  if (!isStripeConfigured) {
    // Degradación elegante §5.6 — se registra el interés para medir demanda.
    // Sin PII: solo tenant. (No se loguea el id de la tienda ni el del usuario.)
    console.info(
      `[marketplace:membresia] Intento de alta con Stripe sin configurar — tenant=${tenant.slug}`,
    );
    return { status: "no_configurado" };
  }

  // Abrir Checkouts es barato para nosotros y caro de auditar si alguien lo
  // hace en loop: la cuota va DESPUÉS del guard y ANTES de Stripe.
  if (!limit(`store-membership:${user.id}`, 10, HOUR_MS).ok) {
    return { status: "error", message: COPY.membership.errors.generic };
  }

  // EL PRECIO DE LA COMUNIDAD (`tenant_prices`, 0072). Es la misma lectura que
  // usa `/marketplace/membresia` para mostrar el monto en la tarjeta del plan.
  const precio = await getPrice(supabase, tenant.id, "store_membership", "estandar", "mensual");
  if (!precio) {
    console.error(
      `[marketplace:membresia] Sin precio para store_membership — tenant=${tenant.slug}`,
    );
    return { status: "error", message: COPY.membership.errors.generic };
  }

  try {
    // Si ya hubo una membresía, se reusa su customer de Stripe para que el
    // historial de facturación del negocio no se parta en dos.
    const { data: existing } = await supabase
      .from("store_memberships")
      .select("id, stripe_customer_id")
      .eq("store_id", storeId)
      .maybeSingle();

    const base = siteUrl();
    const metadata = {
      tenant_id: tenant.id,
      store_id: storeId,
      owner_id: user.id,
      kind: "store_membership",
      // Lo que se decidió cobrar. El webhook lo usa para verificar el monto:
      // en el ALTA todavía no hay fila de `store_memberships` (la crea él), así
      // que sin este dato tendría que adivinar con la constante del código y
      // rechazaría cualquier precio que la comunidad haya configurado.
      price_cents: String(precio.amountCents),
      price_currency: precio.currency,
    };

    const session = await crearCheckoutSession({
      mode: "subscription",
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: user.email }),
      line_items: [
        {
          quantity: 1,
          // `price_data` inline con el precio vigente de esta comunidad. Antes
          // del go-live real, migrar a un Price del dashboard de Stripe — y ahí
          // vive también el "precio fundador", que hoy está FUERA DE ALCANCE
          // por ser una decisión comercial todavía no tomada.
          price_data: {
            // Moneda explícita de la fila; Stripe la quiere en minúsculas.
            currency: precio.currency.toLowerCase(),
            unit_amount: precio.amountCents,
            recurring: { interval: "month" },
            product_data: {
              name: `Membresía de tienda — ${store.title}`,
              metadata: { store_id: storeId },
            },
          },
        },
      ],
      metadata,
      // La metadata se repite en la suscripción: los eventos
      // customer.subscription.* NO traen la de la Session.
      subscription_data: { metadata },
      success_url: `${base}/marketplace/membresia?estado=exito`,
      cancel_url: `${base}/marketplace/membresia?estado=cancelado`,
    });

    if (!session.url) {
      console.error(
        `[marketplace:membresia] Checkout Session sin URL — tenant=${tenant.slug}`,
      );
      return { status: "error", message: COPY.membership.errors.generic };
    }
    return { status: "redirect", url: session.url };
  } catch (error) {
    // Nunca un error técnico crudo al usuario (§5.6). Log sin PII.
    console.error(
      `[marketplace:membresia] Error creando Checkout Session — tenant=${tenant.slug}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY.membership.errors.generic };
  }
}

/**
 * Abre el portal de facturación de Stripe para gestionar o CANCELAR.
 *
 * Cancelar no lo decide esta app: se hace en el portal y vuelve como
 * `customer.subscription.deleted`, que el webhook traduce a `canceled` — el
 * mismo camino que cualquier otro cambio de estado. Prometemos "cancelás
 * cuando quieras" en la pantalla de alta, así que la salida tiene que estar a
 * un toque, no escondida en un correo a soporte.
 */
export async function abrirPortalMembresia(input: unknown): Promise<MembresiaResult> {
  const parsed = activarSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: COPY.membership.errors.generic };
  }
  const { storeId } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // RLS de store_memberships: el dueño ve la suya. El `.eq('owner_id')` hace
  // explícito lo que la policy ya garantiza.
  const { data: membership } = await supabase
    .from("store_memberships")
    .select("id, stripe_customer_id")
    .eq("store_id", storeId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!isStripeConfigured) {
    console.info(
      `[marketplace:membresia] Intento de portal con Stripe sin configurar — tenant=${tenant.slug}`,
    );
    return { status: "no_configurado" };
  }

  if (!membership?.stripe_customer_id) {
    return { status: "error", message: COPY.membership.errors.noPortal };
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: membership.stripe_customer_id,
      return_url: `${siteUrl()}/marketplace/membresia`,
    });
    return { status: "redirect", url: session.url };
  } catch (error) {
    console.error(
      `[marketplace:membresia] Error abriendo el portal — tenant=${tenant.slug}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY.membership.errors.generic };
  }
}
