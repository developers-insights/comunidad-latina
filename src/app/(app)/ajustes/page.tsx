import type { ReactNode } from "react";
import Link from "next/link";
import {
  BellRinging,
  BookmarkSimple,
  CaretRight,
  ChatCircle,
  DeviceMobile,
  FileText,
  Lifebuoy,
  LockKey,
  PencilSimple,
  Prohibit,
  Scales,
  SealCheck,
  ShieldCheck,
  ShieldStar,
  SignIn,
  SlidersHorizontal,
  Sparkle,
  Storefront,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Avatar, Button, buttonVariants } from "@/components/ui";
import { PREFS_COPY } from "@/components/notifications";
import { DeleteAccount } from "@/components/auth/delete-account";
import { getShellContext } from "@/components/shell/shell-context";
import { moduleAvailability } from "@/components/shell/module-access";
import { createClient } from "@/lib/supabase/server";
import { isPhoneVerificationEnabled } from "@/lib/config/services";
import {
  getIdentidadActiva,
  listarIdentidadesDeNegocio,
} from "@/lib/perfil-activo/identidad";
import { leerCheckAzul } from "@/lib/verificacion/read";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { signOutAction } from "../perfil/actions";
import { ThemeRow } from "./theme-row";
import { TimeZoneRow } from "./time-zone-row";
import { COPY } from "./copy";

export const metadata = { title: COPY.title };

/**
 * /ajustes — quinta pestaña del bottom nav (pedido de Manuel, 2026-07-29).
 *
 * Nace para dar casa a lo que quedó huérfano al eliminar el menú lateral: los
 * módulos se fueron a /buscar (ya estaban ahí) y TODO lo demás —notificaciones,
 * tema, cuenta, sesión— aterriza acá.
 *
 * Criterio de qué entra: esto NO es un cajón de sastre. Cada fila lleva a algo
 * que existe y funciona hoy; no hay interruptores decorativos ni preferencias
 * que no muevan nada (avisos por mail, idioma y zona todavía no tienen dónde
 * guardarse, así que no se prometen). Lo que faltaba con nombre propio era la
 * PANTALLA, no las features.
 *
 * Y no duplica: las tres piezas de gestión de cuenta que vivían mezcladas
 * adentro de /perfil (guardados, bloqueados y el bloque de sesión) se MUDARON
 * acá. El perfil queda para lo que es —quién sos de cara a la comunidad— y los
 * ajustes para lo que se administra. Una sola casa por cosa.
 *
 * Anónimo también la ve: tema, normas y legales sirven sin sesión, y arriba
 * queda la invitación a entrar en vez de un 404 en una pestaña fija de la barra.
 */
export default async function AjustesPage() {
  const [shell, supabase, tenant, negocios, identidad] = await Promise.all([
    getShellContext(),
    createClient(),
    getTenant(),
    listarIdentidadesDeNegocio(),
    getIdentidadActiva(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Las dos filas nuevas llevan a módulos que la comunidad puede tener
  // apagados: ofrecer un enlace a una pantalla que devuelve 404 es peor que no
  // ofrecerlo (mismo criterio que la fila del teléfono, más abajo).
  const negociosActivo =
    moduleAvailability("negocios", tenant.modules, tenant.modulesSoon) === "active";
  const creadoresActivo =
    moduleAvailability("creadores", tenant.modules, tenant.modulesSoon) === "active";

  let identityVerified = false;
  let timeZone: string | null = null;
  let phoneVerified = false;
  let checkAzul = false;
  if (user) {
    // Lista explícita: `profiles` es pública y un `*` acá traería rol, estado de
    // cuenta y sanciones para pintar tres filas de ajustes.
    //
    // El check azul se pregunta por `leerCheckAzul` y NO se agrega a este mismo
    // `select` (aunque `verified_badge` es una columna más de `profiles`): es la
    // única función pública para leer esa insignia (src/lib/verificacion/read.ts)
    // y repetir la consulta a mano acá sería una segunda fuente de verdad.
    const [{ data }, badge] = await Promise.all([
      supabase
        .from("profiles")
        .select("identity_verified, timezone, phone_verified")
        .eq("id", user.id)
        .maybeSingle(),
      leerCheckAzul(supabase, user.id),
    ]);
    identityVerified = Boolean(data?.identity_verified);
    timeZone = data?.timezone ?? null;
    phoneVerified = Boolean(data?.phone_verified);
    checkAzul = badge;
  }

  const unreadBadge = shell.unread > 0 ? (shell.unread > 9 ? "9+" : String(shell.unread)) : null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.subtitle}</p>
      </header>

      {/* Identidad: quién está usando la app, y la puerta al perfil. */}
      {shell.user ? (
        <Link
          href="/perfil"
          className={cn(
            "flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3",
            "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <Avatar size="md" name={shell.user.displayName} src={shell.user.avatarUrl} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">
              {shell.user.displayName}
            </span>
            <span className="truncate text-xs text-foreground-muted">
              {COPY.identity.viewProfile}
            </span>
          </span>
          <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
        </Link>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
          >
            <UserCircle size={22} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">
              {COPY.identity.signedOut}
            </span>
            <span className="truncate text-xs text-foreground-muted">
              {COPY.identity.signedOutHint}
            </span>
          </span>
          <Link
            href="/entrar?next=/ajustes"
            className={cn(buttonVariants({ variant: "primary", size: "sm" }), "min-h-11 shrink-0")}
          >
            <SignIn size={16} aria-hidden="true" />
            {COPY.identity.signIn}
          </Link>
        </div>
      )}

      {/* CON QUÉ PERFIL ESTÁS ACTUANDO. Va pegado a la tarjeta de identidad y
          sólo aparece cuando la respuesta NO es la obvia: si estás como vos
          mismo, tu avatar y tu nombre arriba ya lo dicen. Cuando estás como
          negocio, el avatar de arriba sigue siendo el tuyo (es tu cuenta) y por
          eso hace falta decirlo con palabras — la ambigüedad acá no es un
          problema de estilo, es alguien publicando con un nombre que no
          esperaba. */}
      {identidad.tipo === "negocio" && (
        <Link
          href="/negocios/cuenta"
          className={cn(
            "flex items-center gap-3 rounded-xl border border-brand/30 bg-brand-tint p-3",
            "transition-colors duration-(--duration-fast) hover:bg-brand-tint/80",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <span
            aria-hidden="true"
            // `cl-print-hide`: el ícono es tinta `brand-foreground` (clara) sobre
            // un relleno que el papel no imprime — sin el hook queda 1.00:1. Es
            // decoración de una fila de Ajustes: en papel no dice nada.
            className="cl-print-hide flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground"
          >
            <Storefront size={20} weight="fill" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold text-brand-ink">
              {COPY.identity.actingAs(identidad.negocio.nombre)}
            </span>
            <span className="truncate text-xs text-foreground-secondary">
              {COPY.identity.actingAsHint}
            </span>
          </span>
          <span className="shrink-0 text-xs font-semibold text-brand-ink">
            {COPY.identity.switchProfile}
          </span>
        </Link>
      )}

      {shell.user && (
        <>
          <Group title={COPY.groups.activity}>
            <Row
              href="/notificaciones"
              icon={BellRinging}
              {...COPY.rows.notifications}
              badge={unreadBadge}
            />
            <Row href="/mensajes" icon={ChatCircle} {...COPY.rows.messages} />
            <Row href="/perfil/guardados" icon={BookmarkSimple} {...COPY.rows.saved} />
          </Group>

          <Group title={COPY.groups.account}>
            <Row href="/perfil#editar-perfil" icon={PencilSimple} {...COPY.rows.editProfile} />
            {identityVerified ? (
              <Row href="/perfil" icon={ShieldCheck} {...COPY.rows.verified} />
            ) : (
              <Row href="/perfil/verificar" icon={ShieldCheck} {...COPY.rows.verify} />
            )}
            {/* La fila que le faltaba a esta pantalla: el cliente pidió "para
                qué tipo de perfil puedan aplicar el tick, el verificado azul"
                estando ACÁ, y hasta hoy no había ningún camino de Ajustes a
                /verificacion. Va justo después de la identidad porque ese es
                el orden real: primero se verifica (gratis), recién después se
                puede pedir el check azul (pago) — /verificacion lo explica. No
                lleva gate de módulo: el check azul no depende de uno. */}
            <Row
              href="/verificacion"
              icon={SealCheck}
              {...(checkAzul ? COPY.rows.checkAzulActivo : COPY.rows.checkAzul)}
            />
            {/* La fila del teléfono sólo existe con el gate legal abierto
                (PHONE_VERIFICATION_ENABLED). La ruta también devuelve 404 por su
                cuenta: ofrecer un enlace a algo que no se puede usar es peor que
                no ofrecerlo. Ver el comentario de ajustes/telefono/page.tsx. */}
            {isPhoneVerificationEnabled && (
              <Row
                href="/ajustes/telefono"
                icon={DeviceMobile}
                title={phoneVerified ? "Tu teléfono" : "Verificá tu teléfono"}
                description={
                  phoneVerified
                    ? "Ya está verificado. Podés cambiarlo o borrarlo."
                    : "Sumá una capa de confianza a tu cuenta."
                }
              />
            )}
            {/* Las dos puertas que faltaban. La de creador NO rehace nada: el
                flujo entero ya existía en /creadores/solicitud y no había forma
                de llegar desde acá. La de negocio abre el segundo perfil. */}
            {creadoresActivo && (
              <Row
                href="/creadores/solicitud"
                icon={Sparkle}
                {...COPY.rows.becomeCreator}
              />
            )}
            {negociosActivo && (
              <Row
                href="/negocios/cuenta"
                icon={Storefront}
                {...(negocios.length > 0
                  ? COPY.rows.businessAccount
                  : COPY.rows.createBusiness)}
              />
            )}
          </Group>

        </>
      )}

      {/* Privacidad va FUERA del bloque con sesión: los controles de lo que la
          app guardó en este navegador, y la política de cookies, sirven igual
          sin cuenta — y quien todavía no se registró es justo quien más razones
          tiene para querer mirarlos antes de dar su correo. "Cuentas
          bloqueadas" sí necesita sesión, así que es lo único condicionado. */}
      <Group title={COPY.groups.privacy}>
        {/* Candado y no escudo: en esta misma pantalla `ShieldCheck` es la
            marca de la identidad verificada (dos filas más arriba). Prestárselo
            a privacidad la gasta — la insignia de un hecho comprobado no puede
            ser también el ícono genérico de "acá hay algo seguro". */}
        <Row href="/ajustes/privacidad" icon={LockKey} {...COPY.rows.privacy_data} />
        {shell.user && (
          <Row href="/perfil/bloqueados" icon={Prohibit} {...COPY.rows.blocked} />
        )}
      </Group>

      {/* Preferencias y legales sirven con o sin sesión. La de notificaciones
          NO: sin cuenta no hay bandeja que configurar, así que sólo aparece con
          sesión (arriba de Tema, que es lo único que sirve anónimo). La zona
          horaria tampoco: se guarda en el perfil, y sin perfil no hay dónde. */}
      <Group title={COPY.groups.preferences}>
        {shell.user && (
          <Row
            href="/ajustes/notificaciones"
            icon={SlidersHorizontal}
            {...PREFS_COPY.row}
          />
        )}
        {shell.user && <TimeZoneRow initial={timeZone} />}
        <ThemeRow />
      </Group>

      <Group title={COPY.groups.help}>
        <Row href="/legal/normas" icon={Scales} {...COPY.rows.rules} />
        <Row href="/legal/terminos" icon={FileText} {...COPY.rows.terms} />
        {/* Un documento legal, como los otros dos de este grupo. */}
        <Row href="/legal/privacidad" icon={FileText} {...COPY.rows.privacy} />
        <Row href="/ajustes/soporte" icon={Lifebuoy} {...COPY.rows.support} />
      </Group>

      {shell.isStaff && (
        <Group title={COPY.groups.admin}>
          <Row href="/admin" icon={ShieldStar} {...COPY.rows.admin} />
        </Group>
      )}

      {/* Sesión al final y separada: una salida no se mezcla con la navegación,
          y eliminar la cuenta es lo último de todo (acción de alto riesgo). */}
      {shell.user && (
        <section className="flex flex-col gap-3 border-t border-border-subtle pt-6">
          <h2 className="text-sm font-semibold text-foreground">{COPY.groups.session}</h2>
          {user?.email && (
            <p className="text-xs text-foreground-muted">{COPY.session.as(user.email)}</p>
          )}
          <form action={signOutAction}>
            <Button type="submit" variant="outline">
              {COPY.session.signOut}
            </Button>
          </form>
          <p className="text-xs text-foreground-muted">{COPY.session.deleteHint}</p>
          <DeleteAccount />
        </section>
      )}
    </div>
  );
}

/** Bloque de ajustes: título chico + tarjeta con las filas separadas por hairline. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
        {title}
      </h2>
      <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
        {children}
      </div>
    </section>
  );
}

/**
 * Una fila. Alto mínimo 56px (por encima de los 44 del proyecto: son filas de
 * dos líneas) y el chevron SIEMPRE, que es lo que promete "esto abre algo".
 */
function Row({
  href,
  icon: RowIcon,
  title,
  description,
  badge,
}: {
  href: string;
  icon: Icon;
  title: string;
  description: string;
  badge?: string | null;
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
        <RowIcon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-foreground-secondary">{description}</span>
      </span>
      {badge && (
        // `cl-print-hide`: el contador es tinta `brand-foreground` (blanca) sobre
        // un relleno que el papel no imprime — sin el hook queda 1.00:1. Y un
        // "3" de notificaciones sin leer no significa nada impreso.
        <span className="cl-print-hide flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold tabular-nums leading-none text-brand-foreground">
          {badge}
        </span>
      )}
      <CaretRight size={14} aria-hidden="true" className="shrink-0 text-foreground-muted" />
    </Link>
  );
}
