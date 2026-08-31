import Link from "next/link";
import {
  CaretRight,
  CheckCircle,
  SealCheck,
  ShieldWarning,
  SignIn,
  Storefront,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, BezelCard, buttonVariants } from "@/components/ui";
import { getShellContext } from "@/components/shell/shell-context";
import {
  getIdentidadActiva,
  listarIdentidadesDeNegocio,
} from "@/lib/perfil-activo/identidad";
import { PERFIL_ACTIVO_COPY } from "@/lib/perfil-activo/copy";
import { contarNegociosPropios, lugaresDeNegocio } from "@/lib/perfil-activo/tope";
import { cn } from "@/lib/utils";
import { businessCategoryLabel } from "../categories";
import { AltaForm } from "./alta-form";
import { COPY } from "./copy";
import { UsarPerfil } from "./usar-perfil";

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
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
            {COPY.card.heading}
          </h2>

          {negocios.map((negocio) => {
            const activo = negocio.businessId === activeBusinessId;
            const rubro = businessCategoryLabel(negocio.categoria);
            return (
              <BezelCard key={negocio.businessId} coreClassName="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Avatar size="md" name={negocio.nombre} src={negocio.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {negocio.nombre}
                    </p>
                    <p className="truncate text-xs text-foreground-secondary">
                      {[rubro, PERFIL_ACTIVO_COPY.roles[negocio.rol]]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>

                {/* El estado, con todas las letras. Ver el docblock de arriba. */}
                <p
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
                    activo
                      ? "bg-brand-tint font-semibold text-brand-ink"
                      : "bg-surface-subtle text-foreground-secondary",
                  )}
                >
                  {activo ? (
                    <Storefront size={16} weight="fill" aria-hidden="true" />
                  ) : (
                    <UserCircle size={16} aria-hidden="true" />
                  )}
                  {activo ? COPY.card.activeNow : COPY.card.inactiveNow}
                </p>

                {/* La verificación de ESTE perfil (0121). Ícono + palabra, nunca
                    sólo color: la mitad de la gente no distingue verde de gris.
                    El camino para resolverlo es uno solo y está más abajo. */}
                <p
                  className={cn(
                    "flex items-center gap-2 text-xs",
                    negocio.verificada ? "text-success" : "text-foreground-secondary",
                  )}
                >
                  {negocio.verificada ? (
                    <SealCheck size={16} weight="fill" aria-hidden="true" />
                  ) : (
                    <ShieldWarning size={16} aria-hidden="true" />
                  )}
                  {negocio.verificada
                    ? COPY.verificacion.verified
                    : COPY.verificacion.pending}
                </p>

                <UsarPerfil
                  businessId={negocio.businessId}
                  nombre={negocio.nombre}
                  nombrePersonal={nombrePersonal}
                  activo={activo}
                />
              </BezelCard>
            );
          })}
        </section>
      )}

      {/* El alta. Vive acá abajo y no en una rama excluyente: con hasta diez
          negocios, "los que tengo" y "agregar otro" son dos cosas que pasan en
          la misma pantalla. El ancla la usa el cambiador de perfil. */}
      {lugares.puedeCrear ? (
        <section id="nuevo" className="flex flex-col gap-3 scroll-mt-20">
          <h2 className="font-display text-base font-bold text-foreground">
            {negocios.length === 0 ? COPY.form.legend : COPY.form.legendOtro}
          </h2>
          {lugares.usados > 0 && (
            <p className="text-xs text-foreground-secondary">
              {COPY.slots.left(lugares.restantes, lugares.tope)}
            </p>
          )}
          <AltaForm />
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
