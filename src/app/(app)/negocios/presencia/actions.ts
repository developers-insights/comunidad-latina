"use server";

import { z } from "zod";
import { isStripeConfigured } from "@/lib/config/services";
import { getIdentidadActiva } from "@/lib/perfil-activo/identidad";
import { getPrice } from "@/lib/pricing/read";
import { getStripe, PLANES_PRESENCIA } from "@/lib/stripe";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { getTenant } from "@/lib/tenant/resolve";

/** Copy de errores del módulo — cálido, sin jerga técnica. */
const COPY = {
  errorGenerico:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  errorSinNegocio:
    "No pudimos preparar tu cuenta de negocio. Probá de nuevo en un momento.",
  /**
   * Varios negocios y ninguno activo. NO se adivina: acá se está por cobrar
   * una suscripción, y suscribir al negocio equivocado se arregla con un
   * reembolso y una conversación incómoda. Un cartel se arregla con un toque.
   */
  elegiNegocio:
    "Tenés más de un negocio. Cambiá al perfil del negocio que querés hacer verificado —tocá tu foto arriba a la derecha— y volvé a esta pantalla.",
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

  // EL PRECIO DE LA COMUNIDAD, no el del código. Misma lectura que la que ya
  // pintó la tarjeta en `/negocios/presencia` (ver ./precios.ts), así que el
  // número que la persona vio y el que se le cobra son la misma fila. Sin fila
  // configurada, `getPrice` cae a la constante de siempre — este cambio no
  // mueve un centavo hasta que alguien edite un precio en el panel.
  const precio = await getPrice(supabase, tenant.id, "presencia", planId, intervalo);
  if (!precio) {
    console.error(
      `[pagos] Sin precio para presencia/${planId}/${intervalo} — tenant=${tenant.slug}`,
    );
    return { status: "error", message: COPY.errorGenerico };
  }

  try {
    /**
     * QUÉ NEGOCIO SUSCRIBE — y por qué esto dejó de ser una línea.
     *
     * Hasta la 0121 había UNA cuenta de negocio por persona, así que
     * "la del dueño" era una descripción completa y un `.maybeSingle()`
     * alcanzaba. Con hasta 10, ese mismo `.maybeSingle()` es una trampa:
     * PostgREST devuelve PGRST116 cuando la consulta trae más de una fila,
     * `existing` quedaba `null` y la rama de abajo —pensada para "todavía no
     * tiene ninguna"— creaba una cuenta NUEVA con el nombre de la persona.
     * O sea: quien más negocios tiene, más cuentas fantasma se le fabrican,
     * y encima se le cobra la suscripción a la equivocada.
     *
     * La respuesta la da la doctrina que ya gobierna el resto de la app desde
     * la 0116: LA IDENTIDAD ACTIVA MANDA. Si estás actuando como Panadería,
     * el que se hace verificado es Panadería. No hay ambigüedad que resolver.
     *
     * Si estás actuando como vos mismo, hay tres casos y sólo uno se puede
     * decidir solo:
     *   · ningún negocio → se crea el primero (lo de siempre).
     *   · exactamente uno → ése, sin preguntar: no hay otra respuesta posible.
     *   · varios → se PREGUNTA. Elegir por la persona acá es elegir a quién se
     *     le cobra, y eso no se adivina por antigüedad ni por orden alfabético.
     */
    const identidad = await getIdentidadActiva();

    const { data: propias } = await supabase
      .from("business_accounts")
      .select("id, name, stripe_customer_id")
      .eq("owner_id", user.id)
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: true });

    const cuentas = propias ?? [];
    const existing =
      identidad.tipo === "negocio"
        ? cuentas.find((cuenta) => cuenta.id === identidad.negocio.businessId)
        : cuentas.length === 1
          ? cuentas[0]
          : undefined;

    if (!existing && cuentas.length > 1) {
      return { status: "error", message: COPY.elegiNegocio };
    }

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
      // QUIÉN compró. Presencia era el único de los cinco productos que no lo
      // mandaba, y por eso el webhook sólo podía verificar pertenencia de forma
      // indirecta —contra el customer ya vinculado a la cuenta—, que en la
      // PRIMERA compra todavía no existe: justo el camino más común quedaba sin
      // correlacionar. Con esto, `activateVerifiedPresence` exige
      // `business_accounts.owner_id === metadata.owner_id` desde el primer peso.
      owner_id: user.id,
      plan: plan.id,
      intervalo,
      // Lo que se decidió cobrar, para poder reconciliar un cobro viejo contra
      // el precio que regía en ese momento (el historial de precios vive en
      // `tenant_price_history`, pero el comprobante de Stripe también tiene que
      // poder explicarse solo).
      price_cents: String(precio.amountCents),
      price_currency: precio.currency,
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
          // `price_data` inline con el precio VIGENTE de esta comunidad
          // (`tenant_prices`, 0072). Antes del go-live real, migrar a Prices
          // del dashboard de Stripe.
          price_data: {
            // La moneda viaja explícita desde la fila: `tenant_prices.currency`
            // es NOT NULL y ISO 4217 en mayúsculas; Stripe la quiere en
            // minúsculas y esa es la única transformación que se le hace.
            currency: precio.currency.toLowerCase(),
            unit_amount: precio.amountCents,
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
