"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import { m } from "motion/react";
import { BottomSheet } from "@/components/ui";
import {
  CATEGORY_META,
  MORE_TAB_CATEGORIES,
  PRIMARY_TAB_CATEGORIES,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import { inboxHref, type InboxFilter, type InboxTab } from "@/lib/notifications/href";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "./category-icon";
import { COPY } from "./copy";

/** El panel que estas pestañas gobiernan; la página lo rotula con este id. */
export const INBOX_PANEL_ID = "notificaciones-panel";

export const inboxTabId = (tab: InboxTab) => `notificaciones-tab-${tab}`;

export type CategoryTabsProps = {
  active: InboxTab;
  filter: InboxFilter;
  /** No leídas por categoría. La ausencia de una clave ES cero (0045). */
  counts: Partial<Record<NotificationCategory, number>>;
  /** Total sin leer, para la pestaña "Todas". */
  totalUnread: number;
};

/**
 * PESTAÑAS DE LA BANDEJA — patrón WAI-ARIA `tabs`, con dos decisiones firmes:
 *
 * 1. Las pestañas son ENLACES, no botones. Cada categoría es una dirección real
 *    (deep link desde un mail, back del navegador, compartir). `role="tab"` es
 *    válido sobre un `<a>` y el nombre accesible sigue siendo el texto.
 *
 * 2. ACTIVACIÓN MANUAL: las flechas mueven el FOCO, no navegan. La activación
 *    automática es lo correcto cuando cambiar de pestaña es gratis; acá cada
 *    cambio es una consulta al servidor, y recorrer siete pestañas con el
 *    teclado dispararía siete cargas. Enter/Espacio activa (comportamiento
 *    nativo del enlace).
 *
 * "Más" queda FUERA del `role="tablist"` —un tablist sólo contiene tabs— y abre
 * una hoja con el resto. Cuando la categoría activa es una de esas, se dibuja
 * como pestaña extra al final: el estado seleccionado siempre tiene dónde vivir.
 */
export function CategoryTabs({ active, filter, counts, totalUnread }: CategoryTabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const activeIsInMore =
    active !== "todas" && (MORE_TAB_CATEGORIES as readonly string[]).includes(active);

  const tabs: { key: InboxTab; label: string; count: number }[] = [
    { key: "todas", label: COPY.tabs.all, count: totalUnread },
    ...PRIMARY_TAB_CATEGORIES.map((category) => ({
      key: category as InboxTab,
      label: CATEGORY_META[category].label,
      count: counts[category] ?? 0,
    })),
    ...(activeIsInMore
      ? [
          {
            key: active,
            label: CATEGORY_META[active as NotificationCategory].label,
            count: counts[active as NotificationCategory] ?? 0,
          },
        ]
      : []),
  ];

  function onKeyDown(event: React.KeyboardEvent) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;

    const els = Array.from(
      listRef.current?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ?? [],
    );
    if (els.length === 0) return;
    const current = els.indexOf(document.activeElement as HTMLAnchorElement);
    if (current === -1) return;

    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? els.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + els.length) % els.length;
    els[next].focus();
    // El foco tiene que quedar VISIBLE: en móvil la tira scrollea y la pestaña
    // siguiente puede estar fuera de cuadro. Opcional a propósito: jsdom no
    // implementa scrollIntoView, y mover el foco sin poder scrollear sigue
    // siendo correcto — lo que no puede pasar es que la flecha tire una
    // excepción y deje el teclado muerto.
    els[next].scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  const moreUnread = MORE_TAB_CATEGORIES.reduce(
    (total, category) => total + (counts[category] ?? 0),
    0,
  );

  return (
    // `cl-print-hide`: una tira de pestañas impresa es chrome que no dice nada,
    // y el contador de la activa es tinta `brand-foreground` sobre un relleno
    // que el papel no imprime (quedaría 1.00:1). Mismo hook que el badge de
    // /ajustes, por la misma razón.
    <div className="cl-print-hide relative flex items-stretch border-b border-border-subtle">
      <div
        ref={listRef}
        role="tablist"
        aria-label={COPY.tabs.label}
        onKeyDown={onKeyDown}
        className="scrollbar-none flex flex-1 gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <Link
              key={tab.key}
              id={inboxTabId(tab.key)}
              href={inboxHref({ tab: tab.key, filter })}
              role="tab"
              aria-selected={selected}
              aria-controls={INBOX_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              scroll={false}
              className={cn(
                "relative flex h-12 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm",
                "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
                selected
                  ? "font-semibold text-foreground"
                  : "font-medium text-foreground-secondary hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.count > 0 && <TabCount count={tab.count} muted={!selected} />}
              {selected && (
                <m.span
                  layoutId="notificaciones-tab-underline"
                  aria-hidden="true"
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand"
                  transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                />
              )}
            </Link>
          );
        })}
      </div>

      {/* "Más" queda fijo a la derecha; el degradado avisa que la tira de
          pestañas sigue por debajo en vez de cortarse de golpe. Vive dentro del
          contenedor del botón para que no dependa de cuánto mide el botón. */}
      <div className="relative z-1 flex shrink-0 items-stretch bg-canvas">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -left-6 w-6 bg-gradient-to-r from-transparent to-canvas"
        />
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-label={COPY.tabs.moreLabel}
          className={cn(
            "flex h-12 shrink-0 items-center gap-1 pl-2 pr-1 text-sm font-medium",
            "text-foreground-secondary transition-colors duration-(--duration-fast) hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
          )}
        >
          {COPY.tabs.more}
          {moreUnread > 0 && !activeIsInMore && <TabCount count={moreUnread} muted />}
          <CaretDown size={14} aria-hidden="true" />
        </button>
      </div>

      <BottomSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={COPY.tabs.moreSheetTitle}
      >
        <ul className="flex flex-col pb-4">
          {MORE_TAB_CATEGORIES.map((category) => {
            const count = counts[category] ?? 0;
            const meta = CATEGORY_META[category];
            return (
              <li key={category}>
                <Link
                  href={inboxHref({ tab: category, filter })}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active === category ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded-lg px-2 text-left",
                    "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                    active === category && "bg-surface-subtle",
                  )}
                >
                  <CategoryIcon category={category} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">
                      {meta.label}
                    </span>
                    <span className="block truncate text-xs text-foreground-secondary">
                      {meta.description}
                    </span>
                  </span>
                  {count > 0 && <TabCount count={count} />}
                </Link>
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </div>
  );
}

/**
 * El contador. `tabular-nums` para que 9 y 11 ocupen lo mismo y la tira no
 * salte, y el "sin leer" en `sr-only` porque un número suelto no dice nada al
 * lector de pantalla.
 */
function TabCount({ count, muted = false }: { count: number; muted?: boolean }) {
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      className={cn(
        "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5",
        "text-[11px] font-bold leading-none tabular-nums",
        muted ? "bg-surface-subtle text-foreground-secondary" : "bg-brand text-brand-foreground",
      )}
    >
      {label}
      <span className="sr-only"> {COPY.tabs.unreadSuffix(count)}</span>
    </span>
  );
}
