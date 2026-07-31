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
