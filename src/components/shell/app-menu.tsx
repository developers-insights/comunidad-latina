"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  Bell,
  BookOpen,
  CaretRight,
  ChatCircle,
  List,
  PencilSimpleLine,
  ShieldStar,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { Avatar } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";
import { createClient } from "@/lib/supabase/client";
import { signOutAction } from "@/app/(app)/perfil/actions";
import { useBodyScrollLock, useFocusTrap, useMounted } from "@/lib/design/use-overlay";
import { cn } from "@/lib/utils";
import { MODULES, isModuleActive } from "./modules";

const COPY = {
  open: "Abrir menú",
  openWithUnread: (n: number) => `Abrir menú, ${n} sin leer`,
  title: "Menú",
  close: "Cerrar menú",
  explore: "Explorar",
  account: "Tu cuenta",
  viewProfile: "Ver tu perfil",
  signedOut: "Entrá a tu cuenta",
  signedOutHint: "Para publicar y hablar con la comunidad",
  publish: "Publicar algo",
  notifications: "Notificaciones",
  messages: "Mensajes",
  assistant: "Asistente",
  guides: "Guías",
  admin: "Administración",
  theme: "Tema",
  signOut: "Cerrar sesión",
} as const;

export interface AppMenuProps {
  /** null = sin sesión (el menú sigue sirviendo para explorar). */
  user: { displayName: string; avatarUrl: string | null } | null;
  initialUnread: number;
  isStaff: boolean;
}

/**
 * Menú de la app (feedback cliente 2026-07-20: "en vez de que el menú esté
 * arriba tipo catálogo, que haya un botón de menú").
 *
 * Un solo botón en el header reemplaza al rail de módulos, al toggle de tema
 * y a la campana — los tres viven ahora acá adentro. La campana se va pero su
 * señal NO: el botón lleva un punto cuando hay notificaciones sin leer, y el
 * número exacto aparece en la fila de Notificaciones.
 *
 * Jerarquía deliberada: el bottom nav sigue siendo la navegación PRIMARIA
 * (Inicio/Propiedades/Mensajes/Perfil) y este drawer es la SECUNDARIA — los 8
 * módulos, las acciones de cuenta y los ajustes. Un drawer nunca reemplaza a
 * la nav primaria.
 */
export function AppMenu({ user, initialUnread, isStaff }: AppMenuProps) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [prevInitial, setPrevInitial] = useState(initialUnread);
  const pathname = usePathname();
  const panelId = useId();

  // Si el server re-renderiza el shell con un count nuevo, manda el server
  // (patrón "adjust state during render", heredado de la campana).
  if (initialUnread !== prevInitial) {
    setPrevInitial(initialUnread);
    setUnread(initialUnread);
  }

  const refresh = useCallback(async () => {
    try {
      const supabase = createClient();
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (!error && typeof count === "number") setUnread(count);
    } catch {
      // Sin red o sin sesión: se mantiene el último count conocido.
    }
  }, []);

  // Sin polling ni realtime: refresco al volver el foco a la pestaña (§12 pull).
  useEffect(() => {
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Navegar cierra el menú: el panel vive en el layout y no se remonta solo al
  // cambiar de ruta. Se ajusta DURANTE el render (mismo patrón que el count de
  // arriba) — un efecto acá encadenaría un render de más en cada navegación.
  const [pathAtOpen, setPathAtOpen] = useState(pathname);
  if (pathname !== pathAtOpen) {
    setPathAtOpen(pathname);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread > 0 ? COPY.openWithUnread(unread) : COPY.open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={cn(
          "relative flex size-11 shrink-0 items-center justify-center rounded-full",
          "text-foreground-secondary transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
          "hover:bg-surface-hover hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <List size={24} weight="bold" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-brand ring-2 ring-surface"
          />
        )}
      </button>

      <MenuPanel
        id={panelId}
        open={open}
        onClose={() => setOpen(false)}
        user={user}
        unread={unread}
        isStaff={isStaff}
        pathname={pathname}
      />
    </>
  );
}

interface MenuPanelProps {
  id: string;
  open: boolean;
  onClose: () => void;
  user: AppMenuProps["user"];
  unread: number;
  isStaff: boolean;
  pathname: string;
}

function MenuPanel({ id, open, onClose, user, unread, isStaff, pathname }: MenuPanelProps) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `${id}-title`;
  const mounted = useMounted();

  // Foco atrapado + Escape + scroll del body bloqueado: los tres hooks ya
  // reaccionan a `open`, así que sirven igual con AnimatePresence de por medio.
  useFocusTrap(panelRef, open, onClose);
  useBodyScrollLock(open);

  if (!mounted) return null;

  const accountRows = [
    {
      href: "/notificaciones",
      label: COPY.notifications,
      icon: Bell,
      badge: unread > 0 ? (unread > 9 ? "9+" : String(unread)) : null,
    },
    { href: "/mensajes", label: COPY.messages, icon: ChatCircle, badge: null },
    { href: "/asistente", label: COPY.assistant, icon: Sparkle, badge: null },
    { href: "/guias", label: COPY.guides, icon: BookOpen, badge: null },
    ...(isStaff
      ? [{ href: "/admin", label: COPY.admin, icon: ShieldStar, badge: null }]
      : []),
  ];

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <m.div
            className="absolute inset-0 bg-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
            transition={{ duration: 0.28 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <m.div
            ref={panelRef}
            id={id}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn(
              // cl-print-hide: el menú es chrome — en papel no significa nada
              // (y su tinta `on-*` quedaría blanca sobre blanco).
              "cl-print-hide absolute inset-y-0 right-0 flex w-[88vw] max-w-[22rem] flex-col",
              "rounded-l-2xl bg-surface-raised shadow-xl",
            )}
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
            // Entra desde la derecha, que es de donde sale el botón: la
            // dirección del movimiento explica de dónde viene el panel.
            initial={reduceMotion ? { opacity: 0 } : { x: "100%" }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={
              reduceMotion
                ? { opacity: 0, transition: { duration: 0.15 } }
                : { x: "100%", transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }
            }
            transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
            drag={reduceMotion ? false : "x"}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 80 || info.velocity.x > 500) onClose();
            }}
          >
            {/* Cabecera del panel */}
            <div className="flex items-center justify-between gap-2 px-4 pt-4">
              <h2 id={titleId} className="font-display text-lg font-bold text-foreground">
                {COPY.title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={COPY.close}
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-full",
                  "text-foreground-secondary transition-colors duration-(--duration-fast)",
                  "hover:bg-surface-hover hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                <X size={22} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
              {/* Identidad */}
              <Link
                href={user ? "/perfil" : "/entrar"}
                onClick={onClose}
                prefetch={false}
                className={cn(
                  "mt-1 flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3",
                  "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                {user ? (
                  <Avatar size="md" name={user.displayName} src={user.avatarUrl} />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
                  >
                    <Bell size={20} />
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {user ? user.displayName : COPY.signedOut}
                  </span>
                  <span className="truncate text-xs text-foreground-muted">
                    {user ? COPY.viewProfile : COPY.signedOutHint}
                  </span>
                </span>
                <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
              </Link>

              {/* Acción principal */}
              {user && (
                <Link
                  href="/publicar"
                  onClick={onClose}
                  prefetch={false}
                  className={cn(
                    "mt-3 flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-4",
                    "text-sm font-semibold text-brand-foreground shadow-xs",
                    "transition-colors duration-(--duration-fast) hover:bg-brand-hover",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  )}
                >
                  <PencilSimpleLine size={18} weight="bold" aria-hidden="true" />
                  {COPY.publish}
                </Link>
              )}

              {/* Módulos */}
              <h3 className="mb-2 mt-5 px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                {COPY.explore}
              </h3>
              <ul className="grid grid-cols-2 gap-2">
                {MODULES.map((item) => {
                  const active = isModuleActive(pathname, item.href);
                  const IconComponent = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        prefetch={false}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-14 items-center gap-2.5 rounded-xl border p-2.5",
                          "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
                          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                          active
                            ? "border-transparent"
                            : "border-border-subtle bg-surface hover:bg-surface-hover",
                        )}
                        style={
                          active
                            ? {
                                backgroundColor: item.palette.bg,
                                boxShadow: `inset 0 0 0 1.5px ${item.palette.ring}`,
                              }
                            : undefined
                        }
                      >
                        <span
                          aria-hidden="true"
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                          style={{ backgroundColor: item.palette.chip }}
                        >
                          <IconComponent
                            size={20}
                            weight={active ? "fill" : "regular"}
                            style={{ color: item.palette.icon }}
                          />
                        </span>
                        <span
                          className={cn(
                            "min-w-0 flex-1 text-[13px] leading-tight",
                            active
                              ? "font-semibold text-foreground"
                              : "font-medium text-foreground-secondary",
                          )}
                        >
                          {item.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {/* Cuenta */}
              <h3 className="mb-2 mt-5 px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                {COPY.account}
              </h3>
              <ul className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
                {accountRows.map((row, index) => {
                  const RowIcon = row.icon;
                  return (
                    <li key={row.href}>
                      <Link
                        href={row.href}
                        onClick={onClose}
                        prefetch={false}
                        className={cn(
                          "flex min-h-12 items-center gap-3 px-3",
                          index > 0 && "border-t border-border-subtle",
                          "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
                          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
                        )}
                      >
                        <RowIcon
                          size={20}
                          aria-hidden="true"
                          className="shrink-0 text-foreground-muted"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {row.label}
                        </span>
                        {row.badge && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold tabular-nums leading-none text-brand-foreground">
                            {row.badge}
                          </span>
                        )}
                        <CaretRight
                          size={14}
                          aria-hidden="true"
                          className="shrink-0 text-foreground-muted"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {/* Ajustes: tema + salir. Cerrar sesión al final y separado del
                  resto — una acción de salida no se mezcla con la navegación. */}
              <div className="mt-5 flex items-center justify-between rounded-xl border border-border-subtle bg-surface py-1.5 pl-4 pr-2">
                <span className="text-sm text-foreground">{COPY.theme}</span>
                <ThemeToggle />
              </div>

              {user && (
                <form action={signOutAction} className="mt-2">
                  <button
                    type="submit"
                    className={cn(
                      "flex min-h-11 w-full items-center justify-center rounded-xl px-4",
                      "text-sm font-medium text-foreground-secondary",
                      "transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-foreground",
                      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                    )}
                  >
                    {COPY.signOut}
                  </button>
                </form>
              )}
            </div>
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

