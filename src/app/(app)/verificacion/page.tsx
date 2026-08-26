import Link from "next/link";
import {
  Check,
  Info,
  Rocket,
  SealCheck,
  ShieldCheck,
  Sparkle,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { Badge, Banner, BezelCard, buttonVariants } from "@/components/ui";
import { CheckAzul } from "@/components/verificacion/check-azul";
import { COPY_VERIFICACION } from "@/components/verificacion/copy";
import { moduleAvailability } from "@/components/shell/module-access";
import { getIdentidadActiva } from "@/lib/perfil-activo/identidad";
import { tierDeIdentidadActiva } from "@/lib/perfil-activo/tier-sugerido";
import { formatCents } from "@/lib/pricing";
import { getTenantPrices } from "@/lib/pricing/read";
import { findPrice } from "@/lib/pricing/catalog";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { formatDate } from "@/lib/utils";
import {
  VERIFICACION_PLANES,
  VERIFICACION_TIER_IDS,
  type VerificacionTier,
} from "@/lib/verificacion/catalogo";
import {
  grantEsCanjeable,
  llevaCheckAzul,
  supabaseSinTiparVerificacion,
  type VerificacionGrantRow,
  type VerificacionSubscriptionRow,
} from "@/lib/verificacion/types";
import { CanjeForm, type AvisoCanjeable } from "./canje-form";
import { VerificacionActions } from "./verificacion-actions";

/**
 * =============================================================================
 * /verificacion — el check azul: qué es, cuánto sale, y tu impulso de regalo
 * =============================================================================
 *
 * UNA PANTALLA Y NO DOS. La tentación era separar "contratar" de "usar mi
 * regalo", pero son la misma conversación: el regalo es parte de lo que se
 * compra, y quien ya paga entra acá justamente a usarlo. Partirlas obligaría a
 * explicar el regalo dos veces y a que alguien lo descubra por una notificación
 * o no lo descubra nunca.
 *
 * LECTURA: cliente del usuario. `verification_subscriptions_select` y
 * `verification_boost_grants_select` (0101) sólo devuelven las propias, y
 * `listings` filtra por `created_by` — no hace falta el admin client y no se usa
 * (§6: jamás en un request path de usuario).
 *
 * ESCRITURA: ninguna. La suscripción la mueve el webhook de Stripe con
 * service_role; el canje del crédito lo hace su server action.
 *
 * -----------------------------------------------------------------------------
 * LO QUE ESTA PANTALLA TIENE QUE DECIR SÍ O SÍ, aunque venda menos
 *
 * Qué NO significa el check azul. No en letra chica ni escondido en un
 * acordeón: en un bloque propio, con el mismo tamaño que el resto. Quien lo
 * compra ya sabe lo que compra; el que necesita esa información es el vecino
 * que va a VER la insignia en el perfil de alguien y tiene que decidir si le
 * manda plata. A ese no le vendemos nada, y es a quien le debemos la verdad.
 * -----------------------------------------------------------------------------
 */

export const metadata = { title: "El check azul" };

const C = COPY_VERIFICACION;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Lo que la pantalla necesita de la suscripción, y nada más. Los alias viven
 * fuera del componente a propósito: escritos con `typeof` sobre una variable ya
 * inicializada en `null`, TypeScript estrecha el destino del cast a `null` y
 * todo lo que sigue queda tipado `never` — un error mudo que compila igual.
 */
type SuscripcionVista = Pick<
  VerificacionSubscriptionRow,
  "status" | "subject_type" | "current_period_end" | "stripe_customer_id"
>;
type CreditoVista = Pick<VerificacionGrantRow, "id" | "status" | "expires_at">;

export default async function VerificacionPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const estado = (Array.isArray(sp.estado) ? sp.estado[0] : sp.estado) ?? "";
  // Fecha de fin del impulso recién canjeado, que `CanjeForm` manda por la URL
  // (ver su docblock). Es COSMÉTICA: lo que vale ya está escrito en `boosts`, y
  // acá sólo decide qué día se muestra. Por eso alcanza con verificar que sea
  // una fecha parseable — si no lo es, se muestra la confirmación sin el día en
  // vez de un "Invalid Date".
  const hastaCrudo = (Array.isArray(sp.hasta) ? sp.hasta[0] : sp.hasta) ?? "";
  const hasta = hastaCrudo ? new Date(hastaCrudo) : null;
  const hastaLabel =
    hasta && !Number.isNaN(hasta.getTime()) ? formatDate(hasta, { style: "long" }) : null;

  const tenant = await getTenant();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Los precios de ESTA comunidad. Una sola lectura para los tres escalones: el
  // número que se muestra acá es exactamente el que va a cobrar el Checkout,
  // porque los dos salen de `getTenantPrices`.
  const precios = await getTenantPrices(supabase, tenant.id);

  // Estado de quien mira. Sin sesión no hay nada personal que leer: la pantalla
  // sigue siendo útil (precios y qué significa la insignia son públicos a
  // propósito — es la información que protege a quien la lee).
  let suscripcion: SuscripcionVista | null = null;
  let identidadVerificada = false;
  let creditos: CreditoVista[] = [];
  let avisos: AvisoCanjeable[] = [];
  // Con qué escalón coincide la identidad activa AHORA (perfil-activo, 0103).
  // Es una nota de contexto en la tarjeta, nunca una restricción — ver el
  // docblock de `tierDeIdentidadActiva`.
  let sugerido: VerificacionTier | null = null;

  if (user) {
    const cliente = supabaseSinTiparVerificacion(supabase);

    const [perfilRes, subRes, grantRes, listRes, identidad] = await Promise.all([
      supabase.from("profiles").select("identity_verified").eq("id", user.id).maybeSingle(),
      cliente
        .from("verification_subscriptions")
        .select("status, subject_type, current_period_end, stripe_customer_id")
        .eq("profile_id", user.id)
        .maybeSingle(),
      cliente
        .from("verification_boost_grants")
        .select("id, status, expires_at")
        .eq("profile_id", user.id)
        .eq("status", "pendiente")
        .order("expires_at", { ascending: true }),
      supabase
        .from("listings")
        .select("id, title")
        .eq("tenant_id", tenant.id)
        .eq("created_by", user.id)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(50),
      getIdentidadActiva(),
    ]);

    identidadVerificada = perfilRes.data?.identity_verified === true;
    suscripcion = (subRes.data ?? null) as SuscripcionVista | null;
    creditos = ((grantRes.data ?? []) as CreditoVista[]).filter((grant) =>
      grantEsCanjeable(grant),
    );
    avisos = (listRes.data ?? []) as AvisoCanjeable[];
    sugerido = tierDeIdentidadActiva(identidad);
  }

  const activa = llevaCheckAzul(suscripcion);
  const tieneFacturacion = Boolean(suscripcion?.stripe_customer_id);
  const credito = creditos[0] ?? null;
  // Mismo gate que Ajustes: sin esto, la nota de "creador de contenido" abriría
  // una ruta que no existe (o que todavía no abre) en comunidades sin ese módulo.
  const creadoresActivo =
    moduleAvailability("creadores", tenant.modules, tenant.modulesSoon) === "active";

  return (
    <div className="pb-10">
      {/* -------------------------------------------------------- Encabezado */}
      <header className="flex flex-col items-start gap-3">
        <CheckAzul />
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{C.page.title}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{C.page.subtitle}</p>
        </div>
      </header>

      {estado === "exito" && (
        <Banner variant="info" className="mt-4">
          {C.page.pagoEnCamino}
        </Banner>
      )}
      {estado === "cancelado" && (
        <Banner variant="info" className="mt-4">
          {C.page.pagoCancelado}
        </Banner>
      )}
      {/* Confirmación del canje del impulso. Va acá arriba, no dentro de la
          tarjeta del regalo: para cuando esta pantalla se vuelve a pintar, el
          crédito ya no existe y esa tarjeta pasó a decir "te llega uno nuevo el
          mes que viene". Sin este cartel, el único rastro de haber gastado el
          regalo era que el formulario desapareció. */}
      {estado === "impulsado" && (
        <Banner variant="info" className="mt-4">
          <p className="font-semibold text-foreground">{C.regalo.canjeadoTitle}</p>
          <p className="text-foreground-secondary">
            {hastaLabel ? C.regalo.canjeadoBody(hastaLabel) : C.regalo.canjeadoBodySinFecha}
          </p>
        </Banner>
      )}

      {/* --------------------------------------- El requisito: la identidad */}
      {user && (
        <BezelCard className="mt-6 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck
              size={22}
              weight="fill"
              aria-hidden="true"
              className={identidadVerificada ? "shrink-0 text-success-ink" : "shrink-0 text-warning-ink"}
            />
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-foreground">
                {identidadVerificada ? C.identidad.listaTitle : C.identidad.faltaTitle}
              </h2>
              <p className="mt-1 text-sm text-foreground-muted">
                {identidadVerificada ? C.identidad.listaBody : C.identidad.faltaBody}
              </p>
              {!identidadVerificada && (
                <Link
                  href="/perfil/verificar"
                  className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-3`}
                >
                  {C.identidad.faltaCta}
                </Link>
              )}
            </div>
          </div>
        </BezelCard>
      )}

      {/* ------------------------------------------- Tu impulso de regalo */}
      {activa && (
        <BezelCard className="mt-6 p-4">
          <div className="flex items-start gap-3">
            <Rocket size={22} weight="fill" aria-hidden="true" className="shrink-0 text-info-ink" />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-bold text-foreground">
                {C.regalo.title}
              </h2>
              <p className="mt-1 text-sm text-foreground-muted">{C.regalo.blurb}</p>

              {credito ? (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="info">{C.regalo.disponible}</Badge>
                    <span className="text-xs text-foreground-muted">
                      {C.regalo.venceEl(formatDate(new Date(credito.expires_at), { style: "long" }))}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-foreground-muted">{C.regalo.caducidadNota}</p>
                  <div className="mt-3">
                    <CanjeForm grantId={credito.id} avisos={avisos} />
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-foreground-muted">{C.regalo.sinRegalo}</p>
              )}
            </div>
          </div>
        </BezelCard>
      )}

      {/* ------------------------------------------------------ Los planes */}
      <section className="mt-8">
        <h2 className="font-display text-lg font-bold text-foreground">
          {activa ? C.page.yaLoTenes : C.page.elegirPlan}
        </h2>
        {!activa && <p className="mt-1 text-sm text-foreground-muted">{C.page.elegirPlanAyuda}</p>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {VERIFICACION_TIER_IDS.map((tier) => (
            <PlanCard
              key={tier}
              tier={tier}
              precioLabel={precioLabel(precios, tier)}
              activa={activa}
              esElContratado={suscripcion?.subject_type === tier && activa}
              tieneFacturacion={tieneFacturacion}
              coincideConTuCuenta={!activa && sugerido === tier}
            />
          ))}
        </div>

        {activa && suscripcion?.current_period_end && (
          <p className="mt-3 text-xs text-foreground-muted">
            {C.page.pagoHasta(
              formatDate(new Date(suscripcion.current_period_end), { style: "long" }),
            )}
          </p>
        )}
        <p className="mt-2 text-xs text-foreground-muted">{C.page.cancelarNota}</p>
      </section>

      {/* -------------------------------- Qué dice y qué NO dice la insignia */}
      <section className="mt-8">
        <BezelCard className="p-4">
          <div className="flex items-start gap-3">
            <SealCheck size={22} weight="fill" aria-hidden="true" className="shrink-0 text-info-ink" />
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-foreground">
                {C.significado.title}
              </h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {C.significado.dice.map((linea) => (
                  <li key={linea} className="text-sm text-foreground">
                    {linea}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-5 flex items-start gap-3 border-t border-border pt-4">
            <Warning size={22} weight="fill" aria-hidden="true" className="shrink-0 text-warning-ink" />
            <div className="min-w-0">
              <h3 className="font-display text-base font-bold text-foreground">
                {C.significado.noDiceTitle}
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {C.significado.noDice.map((linea) => (
                  <li key={linea} className="text-sm text-foreground-muted">
                    {linea}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm font-medium text-foreground">
                {C.significado.recordatorio}
              </p>
            </div>
          </div>
        </BezelCard>
      </section>

      {/* ---------------------------------- El otro "verificado": creadores */}
      {/* Va AL FINAL a propósito: primero se explica el check azul entero
          —incluidos sus límites—, y recién después se ofrece la salida para
          quien en realidad buscaba otra cosa. Pedido textual del cliente, en
          la misma frase que pidió este check (ver el docblock de
          `C.creadores` en components/verificacion/copy.ts). */}
      {creadoresActivo && (
        <section className="mt-8">
          <BezelCard coreClassName="flex items-start gap-3 p-4">
            <Sparkle
              size={22}
              weight="fill"
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-foreground-muted"
            />
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-foreground">
                {C.creadores.title}
              </h2>
              <p className="mt-1 text-sm text-foreground-muted">{C.creadores.body}</p>
              <Link
                href="/creadores/solicitud"
                className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-3`}
              >
                {C.creadores.cta}
              </Link>
            </div>
          </BezelCard>
        </section>
      )}
    </div>
  );
}

/**
 * El precio del escalón, ya formateado. Sale de `tenant_prices` con respaldo en
 * la constante — `getTenantPrices` nunca devuelve una lista incompleta, así que
 * el `??` de abajo es sólo el cinturón por si alguien suma un escalón al enum y
 * se olvida de la casilla del catálogo.
 */
function precioLabel(
  precios: Awaited<ReturnType<typeof getTenantPrices>>,
  tier: VerificacionTier,
): string {
  const precio = findPrice(precios, "verificacion", tier, "mensual");
  if (!precio) return "—";
  return formatCents(precio.amountCents, precio.currency);
}

function PlanCard({
  tier,
  precioLabel: precio,
  activa,
  esElContratado,
  tieneFacturacion,
  coincideConTuCuenta,
}: {
  tier: VerificacionTier;
  precioLabel: string;
  activa: boolean;
  esElContratado: boolean;
  tieneFacturacion: boolean;
  /** Coincide con la identidad activa ahora — nota de contexto, no un gate. */
  coincideConTuCuenta: boolean;
}) {
  const plan = VERIFICACION_PLANES[tier];

  return (
    <BezelCard className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-base font-bold text-foreground">{plan.nombre}</h3>
        {esElContratado ? (
          <Badge variant="info">{C.page.tuPlan}</Badge>
        ) : (
          plan.destacado && !activa && <Badge variant="brand">{C.page.masElegido}</Badge>
        )}
      </div>

      <p className="mt-1 text-sm text-foreground-muted">{plan.paraQuien}</p>
      {coincideConTuCuenta && (
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-brand-ink">
          <Check size={12} weight="bold" aria-hidden="true" />
          {C.page.coincideConTuCuenta}
        </p>
      )}

      <p className="mt-3">
        <span className="font-display text-2xl font-bold text-foreground">{precio}</span>{" "}
        <span className="text-sm text-foreground-muted">{C.page.porMes}</span>
      </p>

      <ul className="mt-3 flex flex-1 flex-col gap-1.5">
        {plan.incluye.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-foreground-muted">
            <Info size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-info-ink" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <VerificacionActions
          tier={tier}
          yaActiva={activa}
          // El portal se ofrece SÓLO en la tarjeta del plan contratado: repetirlo
          // en los tres haría parecer que cada uno tiene su propia facturación.
          tieneFacturacion={esElContratado && tieneFacturacion}
        />
      </div>
    </BezelCard>
  );
}
