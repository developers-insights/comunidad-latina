import Link from "next/link";
import {
  Check,
  Rocket,
  SealCheck,
  ShieldCheck,
  Sparkle,
  Star,
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
  VERIFICACION_INCLUIDO_SIEMPRE,
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
      {/* `coreClassName` y no `className`: en BezelCard, `className` viste el
          MARCO (el bisel de 6px) y `coreClassName` el contenido. Estaba al
          revés, así que el marco medía 16px y el contenido conservaba su `p-6`
          de default: 40px de aire muerto por lado. Ver la nota del grid de
          planes, más abajo — es la misma causa. */}
      {user && (
        <BezelCard className="mt-6" coreClassName="flex items-start gap-3 p-4">
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
        </BezelCard>
      )}

      {/* ------------------------------------------- Tu impulso de regalo */}
      {activa && (
        <BezelCard className="mt-6" coreClassName="flex items-start gap-3 p-4">
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
        </BezelCard>
      )}

      {/* ------------------------------------------------------ Los planes */}
      <section className="mt-8">
        <h2 className="font-display text-lg font-bold text-foreground">
          {activa ? C.page.yaLoTenes : C.page.elegirPlan}
        </h2>
        {!activa && <p className="mt-1 text-sm text-foreground-muted">{C.page.elegirPlanAyuda}</p>}

        {/* Lo que llevan los tres, ANTES de los tres. Va acá y no dentro de
            cada tarjeta porque es literalmente el mismo texto para todos:
            repetido tres veces era el 66% de la comparativa y tapaba lo único
            que se compara (para quién es, y cuánto sale). Continúa la frase de
            arriba —"el check es el mismo en los tres"— en vez de contradecirla
            con tres listas iguales. */}
        <div className="mt-4 rounded-xl bg-surface-subtle px-4 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
            {VERIFICACION_INCLUIDO_SIEMPRE.titulo}
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {VERIFICACION_INCLUIDO_SIEMPRE.items.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-foreground">
                <Check
                  size={16}
                  weight="bold"
                  aria-hidden="true"
                  className="mt-1 shrink-0 text-success"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* UNA COLUMNA, y no un grid con breakpoints de viewport.
            ────────────────────────────────────────────────────────────────
            Acá había `sm:grid-cols-2 lg:grid-cols-3`. El detalle que lo hacía
            ilegible: `sm:`/`lg:` miden el VIEWPORT, pero el shell de la app
            (app/(app)/layout.tsx) capa el contenido en `max-w-lg` = 512px
            SIEMPRE, también en desktop. Así que en una pantalla de 1280px se
            encendía `lg:grid-cols-3` y repartía 480px útiles en tres columnas
            de 152px; descontando el bisel y el padding de la tarjeta quedaban
            72px medidos de texto real, o sea una palabra por renglón.

            La pantalla hermana de este mismo shell —negocios/presencia, la
            otra suscripción— ya resuelve esto apilando (`flex flex-col`), y
            esta era la única del repo que usaba breakpoints de viewport dentro
            del shell. Se apila igual: dos pantallas de precios que se linkean
            entre sí no pueden estar estructuradas distinto. */}
        <div className="mt-4 flex flex-col gap-4">
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
        <BezelCard coreClassName="p-4">
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
  // El escalón que la pantalla destaca. Cuando ya hay suscripción, el destacado
  // es EL CONTRATADO y no "el más elegido": a quien ya pagó, resaltarle otro
  // plan es venderle algo que no pidió.
  const destacada = esElContratado || (plan.destacado && !activa);
  // Con la suscripción activa, las DOS tarjetas que no son la contratada se
  // quedan sin botón (no se ofrece contratar de nuevo, y el portal va sólo en
  // la del plan que se paga). Sin este gate quedaba montado un contenedor
  // vacío, y el `gap-4` de la tarjeta le regalaba 16px de aire abajo: un hueco
  // que sólo veía quien ya pagó.
  const hayAcciones = !activa || (esElContratado && tieneFacturacion);

  return (
    <BezelCard
      // `featured` tinta el BISEL con el color de la comunidad. Es el recurso
      // que ya usa negocios/presencia para el plan recomendado, y evita el
      // parche de meter un bloque de color adentro de una tarjeta que ya tiene
      // marco propio.
      variant={destacada ? "featured" : "default"}
      // `@container`: de acá para adentro se mide EL ANCHO DE LA TARJETA, no el
      // del viewport. Es lo que faltaba — los `sm:`/`lg:` de antes preguntaban
      // por la ventana, que en esta app no dice nada porque el shell capa todo
      // en 512px. Con esto la tarjeta responde a lo que realmente tiene: ~291px
      // a 375px de viewport, ~428px de 768px para arriba.
      coreClassName="@container flex flex-col gap-4 p-5"
    >
      {/* Identidad del plan + precio. Pasados los 384px de tarjeta el precio se
          va al margen derecho, y como las tres tarjetas son igual de anchas los
          tres precios quedan alineados en una columna: se comparan de un
          vistazo, que es lo único que esta pantalla tiene que hacer fácil. */}
      <div className="flex flex-col gap-3 @sm:flex-row @sm:items-start @sm:justify-between @sm:gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl font-bold text-foreground">{plan.nombre}</h3>
            {esElContratado ? (
              <Badge variant="info">{C.page.tuPlan}</Badge>
            ) : (
              plan.destacado &&
              !activa && (
                <Badge variant="brand">
                  <Star size={12} weight="fill" aria-hidden="true" />
                  {C.page.masElegido}
                </Badge>
              )
            )}
          </div>
          <p className="mt-1 text-sm text-foreground-secondary">{plan.paraQuien}</p>
        </div>

        <p className="flex items-baseline gap-1.5 @sm:shrink-0 @sm:flex-col @sm:items-end @sm:gap-0">
          <span className="numeric font-display text-3xl font-bold leading-none text-foreground">
            {precio}
          </span>
          <span className="text-xs text-foreground-secondary @sm:mt-1">{C.page.porMes}</span>
        </p>
      </div>

      {/* Lo único que cambia entre escalones. Lo compartido ya se dijo arriba. */}
      <p className="flex items-start gap-2 text-sm text-foreground">
        <SealCheck
          size={18}
          weight="fill"
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-info-ink"
        />
        <span>{plan.distintivo}</span>
      </p>

      {coincideConTuCuenta && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-brand-ink">
          <Check size={12} weight="bold" aria-hidden="true" className="shrink-0" />
          {C.page.coincideConTuCuenta}
        </p>
      )}

      {hayAcciones && (
        <VerificacionActions
          tier={tier}
          yaActiva={activa}
          // El portal se ofrece SÓLO en la tarjeta del plan contratado:
          // repetirlo en los tres haría parecer que cada uno tiene su propia
          // facturación.
          tieneFacturacion={esElContratado && tieneFacturacion}
        />
      )}
    </BezelCard>
  );
}
