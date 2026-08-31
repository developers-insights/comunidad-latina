import Link from "next/link";
import {
  CaretRight,
  CheckCircle,
  SignIn,
  Storefront,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, buttonVariants } from "@/components/ui";
import { getShellContext } from "@/components/shell/shell-context";
import {
  getIdentidadActiva,
  listarIdentidadesDeNegocio,
} from "@/lib/perfil-activo/identidad";
import { contarNegociosPropios, lugaresDeNegocio } from "@/lib/perfil-activo/tope";
import { cn } from "@/lib/utils";
import { AltaForm } from "./alta-form";
import { COPY } from "./copy";
import { NegocioCard } from "./negocio-card";

export const metadata = { title: COPY.title };

/**
 * =============================================================================
 * CUENTA DE NEGOCIO — el segundo perfil de la misma cuenta
 * =============================================================================
 *
 * Pedido del cliente, textual: «lo mismo para crear una cuenta de negocio»,
 * «serían como tener 2 perfiles en la misma cuenta, dependiendo la cuenta que
 * quieras usar».
 *
 * La pantalla contesta tres preguntas en este orden, que es el orden en que la
 * persona se las hace:
 *   1. ¿Qué es esto? — antes de pedirle un dato.
 *   2. ¿Cómo lo creo? — dos campos, uno opcional.
 *   3. Ya lo tengo: ¿con cuál estoy actuando AHORA? — y el botón para cambiar.
 *
 * La tercera es la importante y por eso el estado se dice con todas las letras
 * («Estás usando la app con este perfil»), no con un color ni con un ícono. Que
 * alguien no sepa con qué nombre está publicando es peor que no tener la
 * función.
 *
 * Cuelga de /negocios, así que hereda el `ModuleGate` del layout: si la
 * comunidad tiene Negocios apagado, esta ruta no existe — y la fila de Ajustes
 * que lleva acá tampoco se pinta.
 *
 * ── DE UNO A DIEZ (0121) ────────────────────────────────────────────────────
 * Antes esta pantalla tenía dos caras excluyentes: o el formulario de alta, o
 * la tarjeta del único negocio. Con hasta diez, esas dos caras conviven — la
 * lista arriba y el formulario abajo, con `id="nuevo"` para que la fila
 * "Agregar otro negocio" del cambiador caiga directamente ahí.
 *
 * Cuando no quedan lugares el formulario NO se muestra. Un formulario que sólo
 * puede terminar en error no es una función: es una trampa. En su lugar queda
 * dicho cuál es el máximo y qué se puede seguir haciendo.
 *
 * ── LO QUE SE DICE UNA VEZ Y LO QUE SE DICE POR TARJETA ─────────────────────
 * Con diez negocios apareció una diferencia que con uno no se notaba: "con qué
 * perfil estoy actuando" es un dato de LA PERSONA, no de cada negocio. Cuando
 * vivía dentro de la tarjeta, nueve negocios inactivos repetían nueve veces la
 * misma oración sobre el perfil personal. Ahora se dice una sola vez, arriba de
 * la lista, y cada tarjeta sólo se marca a sí misma cuando le toca.
 *
 * La regla del docblock viejo sigue en pie —el estado se dice CON PALABRAS, no
 * con un color— y de hecho se cumple mejor: la frase de arriba nombra el perfil
 * activo, y la tarjeta activa lo repite en un chip con ícono y texto.
 */
export default async function CuentaDeNegocioPage() {
  const [shell, negocios, identidad] = await Promise.all([
    getShellContext(),
    listarIdentidadesDeNegocio(),
    getIdentidadActiva(),
  ]);

  if (!shell.user) {
    return (
      <div className="flex flex-col gap-4">
        <Encabezado />
        {/* `coreClassName`, no `className`: en BezelCard el primero viste el
            CONTENIDO y el segundo el MARCO. Estaba al revés en las cuatro
            tarjetas de esta pantalla, y por eso se veía rota: el bisel pasaba
            de 6px a 16px, el contenido se quedaba con su `p-6` de default (40px
            de padding por lado) y —lo peor— el `flex flex-col gap-3` caía sobre
            un contenedor de un solo hijo, así que adentro de la tarjeta los
            elementos quedaban pegados, sin ninguna separación. */}
        <BezelCard coreClassName="flex flex-col items-start gap-3 p-4">
          <h2 className="font-display text-base font-bold text-foreground">
            {COPY.signedOut.title}
          </h2>
          <p className="text-sm text-foreground-secondary">{COPY.signedOut.body}</p>
          <Link
            href="/entrar?next=/negocios/cuenta"
            className={cn(buttonVariants({ variant: "primary", size: "sm" }), "min-h-11")}
          >
            <SignIn size={16} aria-hidden="true" />
            {COPY.signedOut.cta}
          </Link>
        </BezelCard>
      </div>
    );
  }

  const activeBusinessId =
    identidad.tipo === "negocio" ? identidad.negocio.businessId : null;
  // El negocio activo, si lo hay. Se busca en la lista y no se lee de
  // `identidad` para que el nombre que se muestra sea EL MISMO que el de la
  // tarjeta de abajo: son dos lecturas distintas y podrían no coincidir si
  // alguien renombró el negocio entre una y otra.
  const negocioActivo = negocios.find((n) => n.businessId === activeBusinessId) ?? null;
  // Hoisted: adentro del `.map()` TypeScript pierde el estrechamiento del
  // `if (!shell.user)` de arriba.
  const nombrePersonal = shell.user.displayName;
  // Sólo los PROPIOS consumen lugares: administrar negocios ajenos no tiene
  // tope (0103) y por eso no puede empujar a nadie contra el máximo de diez.
  const lugares = lugaresDeNegocio(contarNegociosPropios(negocios));

  return (
    <div className="flex flex-col gap-6">
      <Encabezado />

      {negocios.length === 0 ? (
        <BezelCard coreClassName="flex flex-col gap-3 p-4">
          <h2 className="font-display text-base font-bold text-foreground">
            {COPY.intro.title}
          </h2>
          <p className="text-sm text-foreground-secondary">{COPY.intro.body}</p>
          <ul className="flex flex-col gap-2">
            {COPY.intro.bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2 text-sm text-foreground">
                <CheckCircle
                  size={18}
                  weight="fill"
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-brand"
                />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </BezelCard>
      ) : (
        <section
          // Sin <h2> visible: el <h1> de arriba ya dice "Tus negocios". El
          // nombre accesible lleva el número, que es el dato que el título no
          // da y que con tope de diez sí importa.
          aria-label={COPY.card.heading(negocios.length)}
          className="flex flex-col gap-4"
        >
          {/* Con qué perfil estás actuando: UNA vez, no una por tarjeta. */}
          <p className="flex items-start gap-2 text-sm text-foreground">
            {negocioActivo ? (
              <Storefront
                size={18}
                weight="fill"
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-brand-ink"
              />
            ) : (
              <UserCircle
                size={18}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-foreground-muted"
              />
            )}
            <span>
              {negocioActivo
                ? COPY.card.usingBusiness(negocioActivo.nombre)
                : COPY.card.usingPersonal(nombrePersonal)}
            </span>
          </p>

          {/* Lista de verdad: con diez filas, "lista de 10 elementos" es la
              primera cosa útil que puede anunciar un lector de pantalla. */}
          <ul className="flex flex-col gap-4">
            {negocios.map((negocio) => (
              <li key={negocio.businessId}>
                <NegocioCard
                  negocio={negocio}
                  activo={negocio.businessId === activeBusinessId}
                  nombrePersonal={nombrePersonal}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* El alta. Vive acá abajo y no en una rama excluyente: con hasta diez
          negocios, "los que tengo" y "agregar otro" son dos cosas que pasan en
          la misma pantalla. El ancla la usa el cambiador de perfil. */}
      {lugares.puedeCrear ? (
        <section id="nuevo" className="scroll-mt-20">
          {/* El alta va DENTRO de una tarjeta desde que hay lista arriba: sin
              un borde propio, el formulario quedaba flotando sobre el fondo
              detrás de diez tarjetas con marco, como si fuera parte de la
              última. La tarjeta lo separa y lo cierra. */}
          <BezelCard coreClassName="flex flex-col gap-3 p-4">
            <div>
              <h2 className="font-display text-base font-bold text-foreground">
                {negocios.length === 0 ? COPY.form.legend : COPY.form.legendOtro}
              </h2>
              {lugares.usados > 0 && (
                <p className="mt-0.5 text-xs text-foreground-secondary">
                  {COPY.slots.left(lugares.restantes, lugares.tope)}
                </p>
              )}
            </div>
            <AltaForm />
          </BezelCard>
        </section>
      ) : (
        <BezelCard
          id="nuevo"
          className="scroll-mt-20"
          coreClassName="flex flex-col gap-1 p-4"
          role="status"
        >
          <h2 className="font-display text-base font-bold text-foreground">
            {COPY.slots.fullTitle(lugares.tope)}
          </h2>
          <p className="text-sm text-foreground-secondary">{COPY.slots.fullBody}</p>
        </BezelCard>
      )}

      {negocios.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
            {COPY.next.heading}
          </h2>
          <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
            <SiguientePaso
              href="/perfil/verificar"
              title={COPY.verificacion.cta}
              description={COPY.verificacion.hint}
            />
            <SiguientePaso
              href="/negocios/presencia"
              title={COPY.next.presenceTitle}
              description={COPY.next.presenceBody}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function Encabezado() {
  return (
    <header>
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.title}
      </h1>
      <p className="mt-1 text-sm text-foreground-secondary">{COPY.subtitle}</p>
    </header>
  );
}

/** Misma fila que usa Ajustes: ícono, dos líneas y chevron. */
function SiguientePaso({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-14 items-center gap-3 px-3",
        "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
      >
        <Storefront size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-foreground-secondary">{description}</span>
      </span>
      <CaretRight size={14} aria-hidden="true" className="shrink-0 text-foreground-muted" />
    </Link>
  );
}
