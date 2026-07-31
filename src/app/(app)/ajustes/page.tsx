import type { ReactNode } from "react";
import Link from "next/link";
import {
  BellRinging,
  BookmarkSimple,
  CaretRight,
  ChatCircle,
  FileText,
  PencilSimple,
  Prohibit,
  Scales,
  ShieldCheck,
  ShieldStar,
  SignIn,
  SlidersHorizontal,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Avatar, Button, buttonVariants } from "@/components/ui";
import { PREFS_COPY } from "@/components/notifications";
import { DeleteAccount } from "@/components/auth/delete-account";
import { getShellContext } from "@/components/shell/shell-context";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { signOutAction } from "../perfil/actions";
import { ThemeRow } from "./theme-row";
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
  const [shell, supabase] = await Promise.all([getShellContext(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let identityVerified = false;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("identity_verified")
      .eq("id", user.id)
      .maybeSingle();
    identityVerified = Boolean(data?.identity_verified);
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
          </Group>

          <Group title={COPY.groups.privacy}>
            <Row href="/perfil/bloqueados" icon={Prohibit} {...COPY.rows.blocked} />
          </Group>
        </>
      )}

      {/* Preferencias y legales sirven con o sin sesión. La de notificaciones
          NO: sin cuenta no hay bandeja que configurar, así que sólo aparece con
          sesión (arriba de Tema, que es lo único que sirve anónimo). */}
      <Group title={COPY.groups.preferences}>
        {shell.user && (
          <Row
            href="/ajustes/notificaciones"
            icon={SlidersHorizontal}
            {...PREFS_COPY.row}
          />
        )}
        <ThemeRow />
      </Group>

      <Group title={COPY.groups.help}>
        <Row href="/legal/normas" icon={Scales} {...COPY.rows.rules} />
        <Row href="/legal/terminos" icon={FileText} {...COPY.rows.terms} />
        <Row href="/legal/privacidad" icon={ShieldCheck} {...COPY.rows.privacy} />
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
