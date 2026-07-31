import Link from "next/link";
import {
  INBOX_FILTERS,
  inboxHref,
  type InboxFilter,
  type InboxTab,
} from "@/lib/notifications/href";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

const LABELS: Record<InboxFilter, string> = {
  todas: COPY.filters.all,
  "no-leidas": COPY.filters.unread,
  importantes: COPY.filters.important,
};

/**
 * Filtro Todas · No leídas · Importantes.
 *
 * Server Component y enlaces reales: el filtro es parte de la dirección, así que
 * el back del navegador vuelve al filtro anterior y la lista la sigue filtrando
 * la base (índices de 0045), no el cliente.
 *
 * NO es un `tablist`: ya hay uno arriba (las categorías) y dos patrones de
 * pestañas en la misma pantalla se pisan con el teclado. Esto es un grupo de
 * enlaces con `aria-current`, que es exactamente lo que es.
 */
export function InboxFilters({ tab, filter }: { tab: InboxTab; filter: InboxFilter }) {
  return (
    <div
      role="group"
      aria-label={COPY.filters.label}
      // `cl-print-hide`: chrome de navegación. Además el chip activo lleva
      // tinta `on-surface-inverse`, clara por definición: sin su relleno —que el
      // navegador no imprime— sería blanco sobre blanco.
      className="cl-print-hide scrollbar-none flex gap-2 overflow-x-auto py-3"
    >
      {INBOX_FILTERS.map((option) => {
        const active = option === filter;
        return (
          <Link
            key={option}
            href={inboxHref({ tab, filter: option })}
            aria-current={active ? "true" : undefined}
            scroll={false}
            className={cn(
              // 44px de alto: es un control de dedo, no una etiqueta.
              "flex min-h-11 shrink-0 items-center rounded-full border px-4 text-xs font-semibold",
              "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              active
                ? "border-transparent bg-surface-inverse text-on-surface-inverse"
                : "border-border-subtle bg-surface text-foreground-secondary hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {LABELS[option]}
          </Link>
        );
      })}
    </div>
  );
}
