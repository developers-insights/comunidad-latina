"use server";

import { z } from "zod";
import { isStripeConfigured } from "@/lib/config/services";
import { getPrice } from "@/lib/pricing/read";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import {
  VERIFICACION_BOOST_DIAS,
  VERIFICACION_BOOST_PACKAGE,
  VERIFICACION_PLANES,
  VERIFICACION_TIERS,
  type VerificacionTier,
} from "@/lib/verificacion/catalogo";
import {
  VERIFICACION_KIND,
  grantEsCanjeable,
  supabaseSinTiparVerificacion,
  type VerificacionGrantRow,
} from "@/lib/verificacion/types";
import { COPY_VERIFICACION } from "@/components/verificacion/copy";

/**
 * =============================================================================
 * CHECK AZUL — alta, gestión y canje del impulso de regalo (0101)
 * =============================================================================
 *
 * Lo que estas actions SÍ hacen: verifican quién pide, que tenga derecho a
 * pedirlo, y abren la Checkout Session (o la del portal, o canjean un crédito
 * que ya existe).
 *
 * Lo que NUNCA hacen: escribir `verification_subscriptions`. Las tres policies
 * de escritura de esa tabla están en `false` (0101) — la fila la crea y la mueve
 * SOLO el webhook de Stripe con service_role. Es la misma doctrina de `boosts`
 * (0016) y de la membresía de tienda (0048): nadie se activa a sí mismo el
 * estado por el que paga. Si esta action insertara la fila, cualquiera con la
 * sesión abierta tendría el check azul gratis llamando al endpoint.
 *
 * (El canje SÍ escribe, pero un crédito que el webhook ya otorgó — y lo hace con
 * un update atómico que es lo que impide gastarlo dos veces. Ver abajo.)
 *
 * Sin Stripe configurado (HOY): se registra el intento sin PII y se devuelve
 * `no_configurado` para que la UI abra `<ProximamentePremium>` (§5.6). El código
 * de Checkout queda completo y listo para el día que exista la clave.
 */

export type VerificacionResult =
  /** Stripe sin configurar: el cliente abre <ProximamentePremium />. */
  | { status: "no_configurado" }
  /** Sin sesión: el cliente redirige a /entrar. */
  | { status: "sin_sesion" }
  /** Falta Stripe Identity: el cliente manda a /perfil/verificar. */
  | { status: "sin_identidad"; message: string }
  | { status: "error"; message: string }
  /** Checkout/portal creado: el cliente navega a la URL de Stripe. */
  | { status: "redirect"; url: string };

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

const activarSchema = z.object({
  tier: z.enum(VERIFICACION_TIERS),
});

/**
 * Abre el Checkout del check azul para la cuenta de quien lo pide.
 *
 * EL SUJETO NO VIAJA EN EL REQUEST. Sólo el escalón (`tier`), que es lo único
 * que la persona elige. A quién se le enciende la insignia lo decide la sesión,
 * siempre: si el `profile_id` llegara del formulario, cualquiera podría pagarle
 * —o hacerle pagar— el check a otro. Es la regla del doc de Server Actions de
 * Next: mandá la referencia y el cambio, derivá la identidad de la sesión.
 *
 * EL ESCALÓN SÍ LO ELIGE LA PERSONA, Y ESO ESTÁ BIEN. No hay forma de que el
 * servidor sepa si alguien "es" un profesional o un negocio, y fingir que la
 * hay sería peor: el escalón es un precio, no una credencial. Lo único que la
 * app garantiza es que se cobra el precio del escalón elegido, que es
 * exactamente lo que verifica el webhook contra la metadata.
 */
export async function activarCheckAzul(input: unknown): Promise<VerificacionResult> {
  const parsed = activarSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: COPY_VERIFICACION.errors.generic };
  }
  const tier: VerificacionTier = parsed.data.tier;

  // Guard PRIMERO: sin coincidencia de tenant no hay nada que cobrar (regla de
  // uso de requireTenantMatch — antes de cualquier efecto colateral).
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // EL REQUISITO. Sin identidad verificada no se vende la insignia — y se corta
  // ACÁ, antes de tocar Stripe, para no cobrarle a alguien algo que el webhook
  // después va a rechazar. La regla completa (y por qué la insignia sería una
  // mentira sin esto) está en la cabecera de la 0101.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, identity_verified")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    console.warn("[verificacion] lectura de perfil falló", { code: profileError.code });
    return { status: "error", message: COPY_VERIFICACION.errors.generic };
  }
  if (!profile?.identity_verified) {
    return {
      status: "sin_identidad",
      message: COPY_VERIFICACION.errors.sinIdentidad,
    };
  }

  // Si ya la tiene activa, no se abre un segundo Checkout: sería una segunda
  // suscripción cobrando lo mismo dos veces. Para cambiar de escalón hay que
  // cancelar y volver a contratar, que es lo que dice la pantalla.
  const cliente = supabaseSinTiparVerificacion(supabase);
  const { data: existente } = await cliente
    .from("verification_subscriptions")
    .select("id, status, stripe_customer_id")
    .eq("profile_id", user.id)
    .maybeSingle();
  const previa = existente as
    | { id: string; status: string; stripe_customer_id: string | null }
    | null;
  if (previa?.status === "active") {
    return { status: "error", message: COPY_VERIFICACION.errors.yaActiva };
  }

  if (!isStripeConfigured) {
    // Degradación elegante §5.6 — se registra el interés para medir demanda.
    // Sin PII: sólo tenant y escalón. (No se loguea el id del usuario.)
    console.info(
      `[verificacion] Intento de alta con Stripe sin configurar — tenant=${tenant.slug} tier=${tier}`,
    );
    return { status: "no_configurado" };
  }

  // Abrir Checkouts es barato para nosotros y caro de auditar si alguien lo hace
  // en loop: la cuota va DESPUÉS del guard y ANTES de Stripe.
  if (!limit(`verificacion:${user.id}`, 10, HOUR_MS).ok) {
    return { status: "error", message: COPY_VERIFICACION.errors.generic };
  }

  // EL PRECIO DE LA COMUNIDAD (`tenant_prices`, 0072/0101). Es la misma lectura
  // que usa la pantalla para mostrar el monto, así que lo que se ve es lo que se
  // cobra.
  const precio = await getPrice(supabase, tenant.id, "verificacion", tier, "mensual");
  if (!precio) {
    console.error(
      `[verificacion] Sin precio para verificacion/${tier} — tenant=${tenant.slug}`,
    );
    return { status: "error", message: COPY_VERIFICACION.errors.generic };
  }

  try {
    const stripe = getStripe();
    const base = siteUrl();
    const metadata = {
      tenant_id: tenant.id,
      profile_id: user.id,
      subject_type: tier,
      kind: VERIFICACION_KIND,
      // Lo que se decidió cobrar. El webhook lo usa para verificar el monto: en
      // el ALTA todavía no hay fila (la crea él), así que sin este dato tendría
      // que adivinar con la constante del código y rechazaría cualquier precio
      // que la comunidad haya configurado. (Ver lib/monetization/pactado.ts.)
      price_cents: String(precio.amountCents),
      price_currency: precio.currency,
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Si ya hubo una suscripción, se reusa su customer para que el historial
      // de facturación de la persona no se parta en dos.
      ...(previa?.stripe_customer_id
        ? { customer: previa.stripe_customer_id }
        : { customer_email: user.email }),
      line_items: [
        {
          quantity: 1,
          // `price_data` inline con el precio vigente de esta comunidad. Antes
          // del go-live real, migrar a un Price del dashboard de Stripe (ver la
          // lista de pasos manuales en el handoff).
          price_data: {
            // Moneda explícita de la fila; Stripe la quiere en minúsculas.
            currency: precio.currency.toLowerCase(),
            unit_amount: precio.amountCents,
            recurring: { interval: "month" },
            product_data: {
              name: `Check azul — ${VERIFICACION_PLANES[tier].nombre}`,
              // Descripción HONESTA también en el recibo de Stripe: es lo que
              // la persona va a ver en su resumen de tarjeta dentro de un año.
              description:
                "Insignia de cuenta con identidad verificada y suscripción activa. No es una recomendación de la plataforma.",
            },
          },
        },
      ],
      metadata,
      // La metadata se repite en la suscripción: los eventos
      // customer.subscription.* y las facturas NO traen la de la Session.
      subscription_data: { metadata },
      success_url: `${base}/verificacion?estado=exito`,
      cancel_url: `${base}/verificacion?estado=cancelado`,
    });

    if (!session.url) {
      console.error(`[verificacion] Checkout Session sin URL — tenant=${tenant.slug}`);
      return { status: "error", message: COPY_VERIFICACION.errors.generic };
    }
    return { status: "redirect", url: session.url };
  } catch (error) {
    // Nunca un error técnico crudo al usuario (§5.6). Log sin PII, pero CON el
    // motivo: un `catch {}` mudo acá es un pago que falla sin que nadie sepa por
    // qué, ni el usuario ni nosotros.
    console.error(
      `[verificacion] Error creando Checkout Session — tenant=${tenant.slug} tier=${tier}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY_VERIFICACION.errors.generic };
  }
}

/**
 * Abre el portal de facturación de Stripe para gestionar o CANCELAR.
 *
 * Cancelar no lo decide esta app: se hace en el portal y vuelve como
 * `customer.subscription.deleted`, que el webhook traduce a `canceled` y el
 * trigger de 0101 convierte en insignia apagada. Prometemos "cancelás cuando
 * quieras" en la pantalla de alta, así que la salida tiene que estar a un toque.
 */
export async function abrirPortalVerificacion(): Promise<VerificacionResult> {
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // RLS de verification_subscriptions: cada quien ve la suya. El `.eq` hace
  // explícito lo que la policy ya garantiza.
  const { data } = await supabaseSinTiparVerificacion(supabase)
    .from("verification_subscriptions")
    .select("id, stripe_customer_id")
    .eq("profile_id", user.id)
    .maybeSingle();
  const fila = data as { id: string; stripe_customer_id: string | null } | null;

  if (!isStripeConfigured) {
    console.info(
      `[verificacion] Intento de portal con Stripe sin configurar — tenant=${tenant.slug}`,
    );
    return { status: "no_configurado" };
  }

  if (!fila?.stripe_customer_id) {
    return { status: "error", message: COPY_VERIFICACION.errors.sinPortal };
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: fila.stripe_customer_id,
      return_url: `${siteUrl()}/verificacion`,
    });
    return { status: "redirect", url: session.url };
  } catch (error) {
    console.error(
      `[verificacion] Error abriendo el portal — tenant=${tenant.slug}`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", message: COPY_VERIFICACION.errors.generic };
  }
}

/* -------------------------------------------------------------------------- */
/* Canje del impulso de regalo                                                */
/* -------------------------------------------------------------------------- */

const canjearSchema = z.object({
  grantId: z.uuid(),
  listingId: z.uuid(),
});

export type CanjeResult =
  | { status: "sin_sesion" }
  | { status: "error"; message: string }
  | { status: "ok"; endsAt: string };

/**
 * Canjea un crédito de impulso sobre un aviso de quien lo pide.
 *
 * -----------------------------------------------------------------------------
 * CÓMO SE GARANTIZA QUE UN CRÉDITO NO SE GASTE DOS VECES
 *
 * NO con un `select` seguido de un `insert`. Dos pedidos simultáneos (doble clic,
 * dos pestañas, un reintento del cliente) leen los dos el mismo `pendiente`, los
 * dos lo dan por bueno, y salen DOS impulsos gratis de un solo crédito.
 *
 * Se hace con un UPDATE CONDICIONAL que es su propio candado:
 *
 *     update ... set status='usado' where id = ? and status = 'pendiente'
 *
 * Postgres serializa las dos escrituras sobre la misma fila: la primera la
 * cambia, la segunda ya no encuentra `pendiente` y no afecta ninguna fila. El
 * `.select()` devuelve vacío y esa rama devuelve el error de "ya lo usaste". No
 * hay ventana entre comprobar y actuar, porque comprobar Y actuar son la MISMA
 * sentencia.
 *
 * El impulso se crea DESPUÉS de reclamar el crédito, no antes. Si el insert del
 * boost fallara, queda un crédito marcado usado sin boost — un regalo perdido,
 * que se reconcilia mirando `boost_id is null`. Al revés (crear el boost primero)
 * el modo de falla sería un impulso regalado con el crédito todavía disponible,
 * o sea gratis infinito. Entre perder un regalo y regalar de más, se pierde.
 * -----------------------------------------------------------------------------
 */
export async function canjearImpulsoDeRegalo(input: unknown): Promise<CanjeResult> {
  const parsed = canjearSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: COPY_VERIFICACION.errors.generic };
  }
  const { grantId, listingId } = parsed.data;

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { tenant, supabase, user } = guard;

  // 1. EL AVISO TIENE QUE SER SUYO Y ESTAR PUBLICADO. Con la RLS del usuario: si
  // no es suyo, para él no existe. El `.eq('created_by')` es explícito igual —
  // es una decisión de plata (de regalo, pero plata), no se deduce.
  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select("id, tenant_id, status, created_by, area_label")
    .eq("id", listingId)
    .eq("tenant_id", tenant.id)
    .eq("created_by", user.id)
    .maybeSingle();
  if (listingError) {
    console.warn("[verificacion:canje] lectura de aviso falló", { code: listingError.code });
    return { status: "error", message: COPY_VERIFICACION.errors.generic };
  }
  if (!listing) return { status: "error", message: COPY_VERIFICACION.errors.noEsTuyo };
  if (listing.status !== "published") {
    return { status: "error", message: COPY_VERIFICACION.errors.noPublicado };
  }

  // 2. EL CRÉDITO TIENE QUE SER SUYO. Se lee con la RLS del usuario, que ya
  // filtra por dueño y tenant — leerlo con el admin client saltearía la única
  // barrera que impide canjear el crédito de otra persona.
  const cliente = supabaseSinTiparVerificacion(supabase);
  const { data: grantData, error: grantError } = await cliente
    .from("verification_boost_grants")
    .select("id, tenant_id, profile_id, status, expires_at, duration_days")
    .eq("id", grantId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (grantError) {
    console.warn("[verificacion:canje] lectura de crédito falló", { code: grantError.code });
    return { status: "error", message: COPY_VERIFICACION.errors.generic };
  }
  const grant = grantData as Pick<
    VerificacionGrantRow,
    "id" | "tenant_id" | "profile_id" | "status" | "expires_at" | "duration_days"
  > | null;

  if (!grant || grant.tenant_id !== tenant.id) {
    return { status: "error", message: COPY_VERIFICACION.errors.sinRegalo };
  }
  if (grant.status === "usado") {
    return { status: "error", message: COPY_VERIFICACION.errors.regaloYaUsado };
  }
  if (!grantEsCanjeable(grant)) {
    return { status: "error", message: COPY_VERIFICACION.errors.regaloVencido };
  }

  // 2.5. EL ALCANCE, ANTES DE GASTAR NADA.
  //
  // ALCANCE 'local' Y NO 'nacional'/'global': el regalo es el impulso base, no
  // el paquete con el recargo de alcance más caro (que se cobra aparte, 0092).
  // Si el aviso no declara zona, no hay "local" posible y cae a 'nacional' con
  // el país de la comunidad — que es lo que exige el CHECK de coherencia.
  //
  // POR QUÉ SE RESUELVE ACÁ Y NO DESPUÉS DE RECLAMAR EL CRÉDITO. Porque puede
  // fallar: un aviso sin zona en una comunidad sin `country_focus` no tiene
  // ningún alcance válido, y el insert de `boosts` rebotaría contra el CHECK.
  // Calculado después del reclamo, eso dejaba el crédito consumido y un
  // "no pudimos" genérico — el regalo perdido por un dato que la persona puede
  // arreglar en dos toques. Ahora se corta antes y se dice qué arreglar.
  const zona = typeof listing.area_label === "string" ? listing.area_label.trim() : "";
  const scopeArea: string | null = zona.length > 0 ? zona : null;
  let scope: "local" | "nacional" = "local";
  let scopeCountry: string | null = null;
  if (!scopeArea) {
    scope = "nacional";
    const { data: t } = await supabase
      .from("tenants")
      .select("country_focus")
      .eq("id", tenant.id)
      .maybeSingle();
    scopeCountry = t?.country_focus ?? null;
    if (!scopeCountry) {
      return { status: "error", message: COPY_VERIFICACION.errors.tenantSinAlcance };
    }
  }

  // 3. RECLAMAR EL CRÉDITO — el update condicional que es su propio candado.
  // Va por el admin client porque las 3 policies de escritura están en false;
  // está GATEADO por todo lo de arriba, igual que el insert de `boosts` en
  // /impulsar.
  const admin = createAdminClient();
  const adminSinTipar = supabaseSinTiparVerificacion(admin);
  const ahora = new Date();
  const { data: reclamado, error: claimError } = await adminSinTipar
    .from("verification_boost_grants")
    .update({ status: "usado", redeemed_at: ahora.toISOString() })
    .eq("id", grant.id)
    .eq("status", "pendiente")
    .lt("granted_at", ahora.toISOString())
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("[verificacion:canje] no se pudo reclamar el crédito", {
      code: claimError.code,
    });
    return { status: "error", message: COPY_VERIFICACION.errors.generic };
  }
  if (!reclamado) {
    // Perdió la carrera: otro pedido ya lo gastó. No es un error del sistema.
    return { status: "error", message: COPY_VERIFICACION.errors.regaloYaUsado };
  }

  // 4. EL IMPULSO. Un boost NORMAL —mismo motor, mismo ranking, mismo chip
  // "Patrocinado"— con `amount_cents = 0` y `origin = 'verificacion'`, que es lo
  // que el CHECK de 0101 exige y lo que permite que el tablero de ingresos no
  // cuente un regalo como facturación. El alcance ya quedó resuelto en 2.5.
  const dias = grant.duration_days ?? VERIFICACION_BOOST_DIAS;
  const endsAt = new Date(ahora.getTime() + dias * 86_400_000);

  const { data: boost, error: boostError } = await adminSinTipar
    .from("boosts")
    .insert({
      tenant_id: tenant.id,
      listing_id: listing.id,
      buyer_id: user.id,
      package: VERIFICACION_BOOST_PACKAGE,
      duration_days: dias,
      amount_cents: 0,
      currency: "usd",
      status: "active",
      origin: "verificacion",
      scope,
      scope_area: scopeArea,
      scope_country: scopeCountry,
      starts_at: ahora.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .select("id")
    .single();

  if (boostError || !boost) {
    // El crédito ya quedó marcado usado (ver la cabecera: es el lado correcto en
    // el que fallar). Queda con `boost_id is null`, que es exactamente lo que
    // hay que buscar para devolvérselo a mano.
    console.error(
      `[verificacion:canje] crédito ${grant.id} reclamado pero el impulso NO se creó — queda con boost_id null para reconciliar. tenant=${tenant.slug} code=${boostError?.code ?? "?"}`,
    );
    return { status: "error", message: COPY_VERIFICACION.errors.generic };
  }

  const boostId = (boost as { id: string }).id;
  await adminSinTipar
    .from("verification_boost_grants")
    .update({ boost_id: boostId })
    .eq("id", grant.id);

  await admin.from("audit_log").insert({
    tenant_id: tenant.id,
    actor_id: user.id,
    action: "verification_boost_redeemed",
    subject_kind: "boost",
    subject_id: boostId,
    meta: { grant_id: grant.id, listing_id: listing.id, duration_days: dias },
  });

  return { status: "ok", endsAt: endsAt.toISOString() };
}
