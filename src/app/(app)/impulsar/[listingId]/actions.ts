"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BOOST_SCOPES, BOOST_SCOPE_COPY, type BoostScope } from "@/lib/boosts";
import { combineBoostPrice } from "@/lib/boosts/price";
import { isStripeConfigured } from "@/lib/config/services";
import { getPrice } from "@/lib/pricing/read";
import { HOUR_MS, limit } from "@/lib/rate-limit";
import { BOOST_PACKAGES, getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getTenant } from "@/lib/tenant/resolve";
import type { Database } from "@/lib/types/database.types";

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
  // El alcance "Tu zona" necesita una zona. Si el aviso no la tiene cargada no
  // se inventa ninguna ni se lo degrada en silencio a un alcance más grande
  // (que además sería más caro): se le dice qué falta y dónde arreglarlo.
  errorSinZona:
    "Para impulsar solo en tu zona, el aviso necesita tener su zona cargada. Editá el aviso y agregala, o elegí un alcance más amplio.",
} as const;

/** Rate limit (fiscal R3): cada intento crea una fila + una Checkout Session. */
const BOOST_HOURLY_LIMIT = 5;

const boostSchema = z.object({
  listingId: z.uuid(),
  paquete: z.enum(["7d", "14d", "30d"]),
  /**
   * Alcance geográfico (0092). NO tiene default a propósito: el alcance cambia
   * lo que se cobra y a quién le llega el aviso, así que asumir uno sería
   * cobrarle a alguien por algo que no eligió. Si no viene, el parseo falla y
   * la pantalla vuelve a pedirlo.
   */
  alcance: z.enum(BOOST_SCOPES),
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
  const { listingId, paquete, alcance } = parsed.data;
  const tenant = await getTenant();
  const boost = BOOST_PACKAGES[paquete];

  if (!isStripeConfigured) {
    // Degradación elegante §5.6 — se registra el interés para medir demanda.
    // El alcance se registra también: saber cuál se elige cuando todavía no se
    // puede pagar es exactamente la señal que sirve para fijar el precio real.
    console.info(
      `[boost] Intento de impulso con Stripe sin configurar — tenant=${tenant.slug} paquete=${paquete} alcance=${alcance}`,
    );
    return { status: "no_configurado" };
  }

  // Guard ANTES del rate limit y del chequeo de ownership: con el tenant del
  // header divergente, el `listing.tenant_id !== tenant.id` de abajo daba
  // `errorNoEsTuyo` sobre un aviso que SÍ era del usuario. Ahora el aviso es
  // verdadero, y no se le quema el cupo horario por un intento imposible.
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { status: "sin_sesion" };
    return { status: "error", message: guard.message };
  }
  const { supabase, user } = guard;

  // Rate limit por usuario ANTES de tocar Stripe/DB: sin esto, un logueado
  // podía generar filas pending_payment + Checkout Sessions sin tope (la
  // purga a 7 días limpia la basura pero no frena el burst).
  if (!limit(`boost:${user.id}`, BOOST_HOURLY_LIMIT, HOUR_MS).ok) {
    return { status: "error", message: COPY.errorMuchosIntentos };
  }

  // EL PRECIO DE LA COMUNIDAD (`tenant_prices`, 0072) — la misma lectura que
  // pintó las tarjetas en /impulsar/[listingId]. Se resuelve UNA vez y ese
  // número entero de centavos va tanto a la fila `boosts.amount_cents` como al
  // `unit_amount` de Stripe: el webhook compara los dos antes de activar, así
  // que tienen que salir de la misma lectura o el impulso nunca arrancaría.
  //
  // El total del impulso son DOS filas de `tenant_prices` sumadas: la duración
  // y el recargo por alcance (0092). La suma la hace `combineBoostPrice`, que
  // es la MISMA función que usó la pantalla para pintar el número — si cada
  // punta sumara por su cuenta, cobraríamos algo que nadie vio.
  const [precioDuracion, precioAlcance] = await Promise.all([
    getPrice(supabase, tenant.id, "boost", paquete, "unico"),
    getPrice(supabase, tenant.id, "boost_scope", alcance, "unico"),
  ]);
  if (!precioDuracion) {
    console.error(`[boost] Sin precio para boost/${paquete} — tenant=${tenant.slug}`);
    return { status: "error", message: COPY.errorGenerico };
  }
  const precio = combineBoostPrice(precioDuracion, precioAlcance);
  if (precio.currencyMismatch) {
    // El recargo quedó configurado en otra moneda que la duración. Se cobra
    // sólo la duración (nunca se convierte al vuelo) y se grita en el log: es
    // un error del panel de precios que alguien tiene que ir a arreglar.
    console.error(
      `[boost] El recargo de alcance '${alcance}' está en ${precioAlcance?.currency} y la duración en ${precioDuracion.currency} — se cobra sólo la duración. tenant=${tenant.slug}`,
    );
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

    // 1b. EL OBJETIVO DEL ALCANCE — lo pone el SERVIDOR, nunca el formulario.
    //
    // La zona sale del aviso (`listings.area_label`, ya leído arriba con la RLS
    // del usuario) y el país de la comunidad (`tenants.country_focus`, resuelta
    // desde el Host). Si el objetivo viajara en el request, cualquiera podría
    // comprar el alcance barato apuntando a la zona más poblada de otra
    // comunidad — el precio del alcance dejaría de tener sentido.
    const objetivo = await resolverObjetivo(supabase, alcance, {
      tenantId: tenant.id,
      areaLabel: listing.area_label,
    });
    if (!objetivo.ok) {
      return { status: "error", message: objetivo.message };
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
        amount_cents: precio.amountCents,
        currency: precio.currency.toLowerCase(),
        status: "pending_payment",
        scope: alcance,
        scope_area: objetivo.area,
        scope_country: objetivo.country,
      })
      .select("id")
      .single();

    if (insertError || !created) {
      console.error(
        `[boost] No se pudo crear el boost — tenant=${tenant.slug} code=${insertError?.code ?? "?"}`,
      );
      return { status: "error", message: COPY.errorGenerico };
    }

    // 3. Checkout one-time. `price_data` inline con el precio vigente de la
    // comunidad; antes del go-live real, migrar a Prices del dashboard.
    const stripe = getStripe();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            // Moneda explícita de `tenant_prices` (Stripe la quiere minúscula),
            // y el MISMO entero que quedó en `boosts.amount_cents`.
            currency: precio.currency.toLowerCase(),
            unit_amount: precio.amountCents,
            product_data: {
              // Solo texto: es lo que la persona lee en el Checkout de Stripe y
              // en su comprobante. La `metadata.package` de abajo SÍ es un valor
              // que el webhook correlaciona — por eso queda intacta.
              //
              // El alcance entra en el nombre porque es la mitad de lo que se
              // está pagando: un comprobante que dice sólo "Impulso 14 días" no
              // explica por qué salió más caro que el de la semana pasada.
              name: `Impulso ${boost.nombre} · ${BOOST_SCOPE_COPY[alcance].label} — aviso patrocinado`,
              metadata: { package: boost.id, scope: alcance },
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

/**
 * A QUÉ APUNTA EL ALCANCE — resuelto en el servidor, con datos del servidor.
 *
 * `local` apunta a la zona del propio aviso; `nacional`, al país de la
 * comunidad; `global` no apunta a nada porque llega a todas. Ninguno de los dos
 * datos llega por el request: la zona sale de la fila del aviso (leída con la
 * RLS del dueño) y el país de `tenants`, resuelto desde el Host.
 *
 * Por qué no se acepta el objetivo por parámetro: el precio del alcance depende
 * de qué tan grande es. Si el comprador pudiera elegir a qué zona apunta su
 * boost "local", compraría el escalón barato apuntado al barrio más poblado de
 * otra comunidad — y el precio dejaría de medir lo que mide.
 */
async function resolverObjetivo(
  supabase: SupabaseClient<Database>,
  alcance: BoostScope,
  contexto: { tenantId: string; areaLabel: string | null },
): Promise<
  | { ok: true; area: string | null; country: string | null }
  | { ok: false; message: string }
> {
  if (alcance === "global") {
    return { ok: true, area: null, country: null };
  }

  if (alcance === "local") {
    const zona = contexto.areaLabel?.trim();
    // Sin zona no hay alcance local. No se degrada a `nacional` en silencio:
    // sería cobrarle a alguien un escalón más caro que el que eligió.
    if (!zona) return { ok: false, message: COPY.errorSinZona };
    return { ok: true, area: zona.slice(0, 80), country: null };
  }

  const { data: tenantRow, error } = await supabase
    .from("tenants")
    .select("country_focus")
    .eq("id", contexto.tenantId)
    .maybeSingle();

  if (error) {
    // El país no se pudo leer. Se sigue con `null`, que la 0092 acepta y
    // significa "el país de la comunidad que lo vendió": el impulso funciona
    // completo puertas adentro y sólo se pierde la salida a las comunidades
    // hermanas. Se registra para que no pase desapercibido.
    console.warn(
      `[boost] No se pudo leer el país de la comunidad ${contexto.tenantId} — el impulso nacional no saldrá a las comunidades hermanas`,
      { code: error.code },
    );
    return { ok: true, area: null, country: null };
  }

  const pais = tenantRow?.country_focus?.trim();
  return { ok: true, area: null, country: pais ? pais.slice(0, 60).toUpperCase() : null };
}
