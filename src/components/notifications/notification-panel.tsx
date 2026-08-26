"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Bell,
  BellSimple,
  Checks,
  CloudSlash,
  SlidersHorizontal,
} from "@phosphor-icons/react/dist/ssr";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  isNotificationCategory,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import type { NotificationPanelItem } from "@/lib/notifications/panel";
import {
  getNotificationPanelAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(app)/notificaciones/actions";
import { useCloseOnBack, useFocusTrap, useMounted } from "@/lib/design/use-overlay";
import { CategoryIcon } from "./category-icon";
import { COPY } from "./copy";

/**
 * =============================================================================
 * LA CAMPANA, CON GAVETA — mirar los avisos sin salirse del feed
 * =============================================================================
 *
 * Pedido de Manuel (2026-08-25): «el botón de las notificaciones te lleva de una
 * a otro screen, y no debería; de última que solo se despliegue un buen
 * desplegable, para no perder el foco en el feed».
 *
 * El costo real de la campana-enlace no era el viaje de ida: era el de vuelta.
 * El feed es una lista larga con posición de lectura, y volver de
 * /notificaciones devolvía arriba de todo. Mirar de reojo si el aviso era
 * importante costaba perder el lugar donde estabas leyendo. Ahora la campana
 * abre una gaveta anclada al header y el feed sigue exactamente donde estaba.
 *
 * ── LA BANDEJA COMPLETA NO DESAPARECE ───────────────────────────────────────
 * Esto es un vistazo de seis filas, no un reemplazo: pestañas por categoría,
 * filtros, agrupado por tiempo, el ⋯ de cada fila y "deshacer" siguen viviendo
 * en /notificaciones, a un toque del pie del panel. Meter todo eso adentro de
 * una gaveta de 360px sería hacer las dos cosas mal.
 *
 * ── POR QUÉ UN PORTAL Y NO UN `absolute` COLGADO DE LA CAMPANA ──────────────
 * Dos razones, las dos concretas:
 *
 *  1. A 375px el panel no entra a la derecha de la campana. Anclado al botón,
 *     su borde izquierdo cae fuera de la pantalla.
 *  2. El `<header>` lleva `backdrop-blur-md`, y un elemento con `backdrop-filter`
 *     es BLOQUE CONTENEDOR de sus descendientes `fixed`. Un velo `fixed inset-0`
 *     adentro del header cubriría el header, no la pantalla.
 *
 * Así que el panel vive en un portal a `document.body`, alineado a la MISMA
 * columna `max-w-lg` que usa el header —por eso se lee como una gaveta del
 * header y no como una caja que flota en cualquier lado— y su distancia al
 * borde de arriba se MIDE del propio botón. Nada de constantes con la altura
 * del header adentro: el día que el header cambie de alto, esto no se entera.
 *
 * ── DATOS FRESCOS, CADA VEZ ─────────────────────────────────────────────────
 * La lista se pide al abrir (server action), no en el render del header: el
 * header se renderiza en cada navegación de la app y la gaveta se abre pocas
 * veces. Mientras vuelve la consulta se muestran las filas anteriores —nunca un
 * salto a esqueleto si ya había algo que mirar— y sólo la primera vez se ve el
 * esqueleto.
 *
 * ── EL GLOBITO NO MIENTE ────────────────────────────────────────────────────
 * El número lo pinta el servidor (`NotificationBell`), así que está bien desde
 * el primer frame, incluso antes de que este componente hidrate. A partir de
 * ahí lo corrige lo que pase acá adentro: abrir un aviso lo baja de a uno,
 * "marcar leídas" lo lleva a cero. Y cuando el servidor vuelve a decir lo suyo
 * en la próxima navegación, su palabra manda.
 */

/** Techo visual del globito: por encima se lee "9+", no el número real. */
const MAX_DISPLAY = 9;

/** Aire entre el borde de abajo del botón y el panel. */
const GAP = 8;

type Estado = "vacio" | "cargando" | "listo" | "error";

export function NotificationPanel({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const mounted = useMounted();
  const reduceMotion = useReducedMotion();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(0);
  const [estado, setEstado] = useState<Estado>("vacio");
  const [items, setItems] = useState<NotificationPanelItem[]>([]);
  const [, startTransition] = useTransition();

  /**
   * El conteo del servidor y el que se está mostrando, en dos estados. Cuando el
   * servidor cambia de opinión (otra navegación, otro aviso) su número vuelve a
   * mandar; entre medio manda lo que pasó en esta gaveta. Es el patrón de React
   * para "estado que se resetea cuando cambia una prop", sin efecto de por medio.
   */
  const [serverUnread, setServerUnread] = useState(initialUnread);
  const [unread, setUnread] = useState(initialUnread);
  if (serverUnread !== initialUnread) {
    setServerUnread(initialUnread);
    setUnread(initialUnread);
  }

  /** Descarta la respuesta de una consulta vieja que llegó tarde. */
  const pedidoRef = useRef(0);

  const cargar = useCallback(async () => {
    const pedido = pedidoRef.current + 1;
    pedidoRef.current = pedido;
    setEstado((previo) => (previo === "listo" ? "listo" : "cargando"));

    const resultado = await getNotificationPanelAction().catch(
      () => ({ ok: false }) as const,
    );
    if (pedidoRef.current !== pedido) return;

    if (!resultado.ok) {
      setEstado("error");
      return;
    }
    setItems(resultado.data.items);
    setUnread(resultado.data.unread);
    setServerUnread(resultado.data.unread);
    setEstado("listo");
  }, []);

  /** Mide dónde termina el botón: el panel cuelga de ahí, no de un número fijo. */
  const medir = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setTop(rect.bottom + GAP);
  }, []);

  const cerrar = useCallback(() => setOpen(false), []);

  useFocusTrap(panelRef, open, cerrar);
  useCloseOnBack(open, cerrar);

  // El header es `sticky top-0`: mientras la página scrollea, el botón no se
  // mueve. Lo que sí lo mueve es un cambio de ancho (rotar el teléfono, o el
  // wordmark que aparece y desaparece a 375px), así que eso sí se re-mide.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [open, medir]);

  function alternar() {
    if (open) {
      setOpen(false);
      return;
    }
    medir();
    setOpen(true);
    void cargar();
  }

  /**
   * Abrir un aviso lo marca leído SIN esperar a la base: la navegación no puede
   * quedar detrás de un round-trip. Si el update falla, el aviso vuelve a
   * aparecer sin leer en la próxima carga — que es exactamente lo correcto.
   */
  function abrirAviso(item: NotificationPanelItem) {
    setOpen(false);
    if (item.read) return;
    setItems((previos) =>
      previos.map((otro) => (otro.id === item.id ? { ...otro, read: true } : otro)),
    );
    setUnread((previo) => Math.max(0, previo - 1));
    startTransition(async () => {
      await markNotificationReadAction(item.id).catch(() => undefined);
      router.refresh();
    });
  }

  function marcarTodas() {
    setItems((previos) => previos.map((item) => ({ ...item, read: true })));
    setUnread(0);
    startTransition(async () => {
      await markAllNotificationsReadAction().catch(() => undefined);
      router.refresh();
    });
  }

  const hayGlobito = unread > 0;
  const display = unread > MAX_DISPLAY ? `${MAX_DISPLAY}+` : String(unread);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={alternar}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          hayGlobito ? `${COPY.panel.open}, ${COPY.panel.unread(unread)}` : COPY.panel.open
        }
        className={cn(
          "relative flex size-11 shrink-0 items-center justify-center rounded-full",
          "text-foreground-secondary transition-colors duration-(--duration-fast)",
          "hover:bg-surface-hover hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          open && "bg-surface-hover text-foreground",
        )}
      >
        <Bell size={24} weight={open ? "fill" : "regular"} aria-hidden="true" />
        {hayGlobito && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[11px] leading-none font-bold tabular-nums text-on-danger ring-2 ring-surface"
          >
            {display}
          </span>
        )}
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <>
                {/* Velo apenas perceptible: la gaveta tiene que despegarse del
                    fondo, pero oscurecer el feed sería contradecir el motivo por
                    el que existe — que el feed siga ahí. */}
                <m.div
                  className="fixed inset-0 z-40 bg-scrim/25"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.22 }}
                  onClick={cerrar}
                  aria-hidden="true"
                />

                {/* La MISMA columna que el header, hasta el `px-4`: `mx-auto
                    max-w-lg px-4` es exactamente lo que envuelve al logo y al
                    avatar. Por eso el borde derecho del panel cae en la misma
                    línea que el avatar y se lee como una gaveta del header, no
                    como una caja que flota cerca. */}
                <div
                  className="pointer-events-none fixed inset-x-0 z-50 mx-auto flex w-full max-w-lg justify-end px-4"
                  style={{ top }}
                >
                  <m.div
                    ref={panelRef}
                    role="dialog"
                    aria-label={COPY.panel.label}
                    tabIndex={-1}
                    className={cn(
                      "pointer-events-auto flex w-full flex-col overflow-hidden sm:w-[22.5rem]",
                      "origin-top-right rounded-2xl border border-border-subtle",
                      "bg-surface-raised shadow-xl focus-visible:outline-none",
                    )}
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                    exit={
                      reduceMotion
                        ? { opacity: 0, transition: { duration: 0.12 } }
                        : {
                            opacity: 0,
                            y: -6,
                            scale: 0.98,
                            transition: { duration: 0.15, ease: [0.4, 0, 1, 1] },
                          }
                    }
                    transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                  >
                    <PanelHeader unread={unread} onMarkAll={marcarTodas} onClose={cerrar} />

                    <div className="max-h-[min(60dvh,25rem)] overflow-y-auto overscroll-contain px-2 py-2">
                      {estado === "cargando" && items.length === 0 && <PanelSkeleton />}
                      {estado === "error" && <PanelError onRetry={() => void cargar()} />}
                      {estado !== "error" && items.length > 0 && (
                        <ul className="flex flex-col gap-1">
                          {items.map((item) => (
                            <PanelRow key={item.id} item={item} onOpen={() => abrirAviso(item)} />
                          ))}
                        </ul>
                      )}
                      {estado === "listo" && items.length === 0 && <PanelEmpty />}
                    </div>

                    <PanelFooter onNavigate={cerrar} />
                  </m.div>
                </div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

/* ── Partes ────────────────────────────────────────────────────────────────── */

function PanelHeader({
  unread,
  onMarkAll,
  onClose,
}: {
  unread: number;
  onMarkAll: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-bold tracking-tight text-foreground">
          {COPY.title}
        </p>
        <p className="text-xs text-foreground-secondary">
          {unread > 0 ? COPY.panel.unread(unread) : COPY.panel.allRead}
        </p>
      </div>

      {unread > 0 && (
        <button
          type="button"
          onClick={onMarkAll}
          className={cn(
            "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold",
            "text-brand-ink transition-colors duration-(--duration-fast) hover:bg-brand-tint",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <Checks size={15} weight="bold" aria-hidden="true" />
          {COPY.header.markAllShort}
        </button>
      )}

      {/* Preferencias: la otra puerta que la bandeja ya ofrecía arriba a la
          derecha. Cierra la gaveta al navegar — si no, vuelve abierta. */}
      <Link
        href="/ajustes/notificaciones"
        onClick={onClose}
        aria-label={COPY.header.settings}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          "text-foreground-muted transition-colors duration-(--duration-fast)",
          "hover:bg-surface-hover hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * Fila compacta. Es prima de `NotificationItem` (la de /notificaciones) pero no
 * la misma: acá no hay ⋯ ni pastilla de acción, y el cuerpo se corta en una
 * línea. Lo que sí se conserva es CÓMO se dice "sin leer" — punto, peso del
 * título y superficie, tres señales que no dependen del color, más el `sr-only`.
 */
function PanelRow({ item, onOpen }: { item: NotificationPanelItem; onOpen: () => void }) {
  const category: NotificationCategory = isNotificationCategory(item.category)
    ? item.category
    : "social";

  const clase = cn(
    "flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left",
    "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
    "hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
    !item.read && "bg-brand-tint/40",
  );

  const contenido = (
    <>
      <CategoryIcon
        category={category}
        className={cn("size-9", item.read ? undefined : "bg-brand-tint text-brand-ink")}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "min-w-0 text-sm leading-snug text-foreground",
              item.read ? "font-medium" : "font-semibold",
            )}
          >
            {item.title}
          </span>
          <time
            dateTime={item.createdAt}
            className="shrink-0 text-[11px] tabular-nums text-foreground-muted"
          >
            {item.timeLabel}
          </time>
        </span>
        {item.body && (
          <span className="mt-0.5 block truncate text-xs leading-relaxed text-foreground-secondary">
            {item.body}
          </span>
        )}
      </span>
      {!item.read && (
        <>
          <span
            aria-hidden="true"
            className="mt-1.5 size-2 shrink-0 self-start rounded-full bg-brand"
          />
          <span className="sr-only">{COPY.row.unread}</span>
        </>
      )}
    </>
  );

  return (
    <li>
      {item.href ? (
        <Link href={item.href} onClick={onOpen} className={clase}>
          {contenido}
        </Link>
      ) : (
        // Sin destino no hay enlace: el aviso se marca leído y se queda donde
        // está (una campaña que arrancó, un cambio de estado).
        <button type="button" onClick={onOpen} className={clase}>
          {contenido}
        </button>
      )}
    </li>
  );
}

function PanelFooter({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="border-t border-border-subtle p-2">
      <Link
        href="/notificaciones"
        onClick={onNavigate}
        className={cn(
          "flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold",
          "text-brand-ink transition-colors duration-(--duration-fast) hover:bg-brand-tint",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        {COPY.panel.seeAll}
        <ArrowRight size={15} weight="bold" aria-hidden="true" />
      </Link>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-1" role="status" aria-label={COPY.panel.loading}>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex items-start gap-3 px-2.5 py-2.5">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="mt-2 h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * VACÍO y ERROR se ven distinto a propósito: acá viven las alertas de seguridad
 * y los pagos fallidos, así que "no pudimos leer" jamás puede parecerse a "no
 * tenés nada".
 */
function PanelEmpty() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-surface-subtle text-foreground-muted"
      >
        <BellSimple size={22} />
      </span>
      <p className="text-sm font-semibold text-foreground">{COPY.panel.emptyTitle}</p>
      <p className="text-xs leading-relaxed text-foreground-secondary">{COPY.panel.emptyBody}</p>
    </div>
  );
}

function PanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-surface-subtle text-warning-ink"
      >
        <CloudSlash size={22} />
      </span>
      <p className="text-sm font-semibold text-foreground">{COPY.panel.errorTitle}</p>
      <p className="text-xs leading-relaxed text-foreground-secondary">{COPY.panel.errorBody}</p>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "mt-1 flex min-h-9 items-center rounded-full px-3 text-xs font-semibold",
          "text-brand-ink transition-colors duration-(--duration-fast) hover:bg-brand-tint",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        {COPY.panel.retry}
      </button>
    </div>
  );
}
