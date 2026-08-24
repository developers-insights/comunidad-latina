/**
 * NOTIFICACIONES — el estado de la bandeja vive en la URL.
 *
 * Pestaña y filtro son parámetros, no estado de cliente: así la pantalla es un
 * Server Component que filtra e indexa en la base (0045 tiene un índice por
 * `category`), el back del navegador vuelve a donde estabas, y un aviso se puede
 * compartir o linkear desde un mail. Además el contador de cada pestaña se
 * calcula una sola vez por carga en vez de por interacción.
 */

import { isNotificationCategory, type NotificationCategory } from "./categories";

export const INBOX_FILTERS = ["todas", "no-leidas", "importantes"] as const;

export type InboxFilter = (typeof INBOX_FILTERS)[number];

export function isInboxFilter(value: unknown): value is InboxFilter {
  return typeof value === "string" && (INBOX_FILTERS as readonly string[]).includes(value);
}

/** "todas" es la pestaña sin categoría, no una categoría. */
export type InboxTab = "todas" | NotificationCategory;

export type InboxQuery = {
  tab: InboxTab;
  filter: InboxFilter;
};

export const DEFAULT_INBOX_QUERY: InboxQuery = { tab: "todas", filter: "todas" };

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Cualquier basura en la query cae en el default: la bandeja nunca rompe. */
export function parseInboxQuery(
  searchParams: Record<string, string | string[] | undefined>,
): InboxQuery {
  const rawTab = firstValue(searchParams.c).slice(0, 20);
  const rawFilter = firstValue(searchParams.f).slice(0, 20);
  return {
    tab: isNotificationCategory(rawTab) ? rawTab : "todas",
    filter: isInboxFilter(rawFilter) ? rawFilter : "todas",
  };
}

/**
 * Los dos ids que atan las pestañas con su panel (patrón WAI-ARIA `tabs`): cada
 * pestaña lleva `aria-controls={INBOX_PANEL_ID}` y el panel se rotula con
 * `aria-labelledby={inboxTabId(tab)}`.
 *
 * VIVEN ACÁ, y no en `components/notifications/category-tabs.tsx` —que es donde
 * se dibujan las pestañas— porque los dos extremos de esa relación ARIA no están
 * del mismo lado del río: las pestañas son un client component, pero el panel lo
 * rotula la página, que es Server Component.
 *
 * `"use client"` no significa "esto corre en el navegador": es un LÍMITE de
 * módulo. Cuando el servidor importa algo de un archivo marcado así, no recibe
 * el valor sino una referencia al cliente. Con estas dos constantes adentro de
 * `category-tabs.tsx`, la página leía `INBOX_PANEL_ID` y obtenía una función en
 * vez de "notificaciones-panel", y al llamar a `inboxTabId()` el render moría con
 *
 *   Attempted to call inboxTabId() from the server but inboxTabId is on the
 *   client. It's not possible to invoke a client function from the server, it
 *   can only be rendered as a Component or passed to props of a Client Component.
 *
 * o sea: la bandeja entera contra el error boundary, en cada visita. Es la misma
 * razón por la que `inboxHref` ya vivía en este módulo — lo que consumen los dos
 * lados no puede nacer adentro del límite de uno. De un archivo `"use client"`
 * el servidor sólo puede importar COMPONENTES, para renderizarlos.
 */
export const INBOX_PANEL_ID = "notificaciones-panel";

export const inboxTabId = (tab: InboxTab) => `notificaciones-tab-${tab}`;

/** URL canónica: los defaults NO se escriben, así no hay dos direcciones para
 *  la misma pantalla (y el prefetch de Next cachea una sola). */
export function inboxHref(query: Partial<InboxQuery>): string {
  const tab = query.tab ?? DEFAULT_INBOX_QUERY.tab;
  const filter = query.filter ?? DEFAULT_INBOX_QUERY.filter;

  const params = new URLSearchParams();
  if (tab !== "todas") params.set("c", tab);
  if (filter !== "todas") params.set("f", filter);

  const qs = params.toString();
  return qs ? `/notificaciones?${qs}` : "/notificaciones";
}
