import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  FILTROS_DE_PERSONAS,
  hrefDeFiltro,
  type FiltroDePersonas,
} from "@/lib/messaging/bandeja";
import { COPY } from "./copy";

const ETIQUETA: Record<FiltroDePersonas, string> = {
  todos: COPY.inbox.filterAll,
  amigos: COPY.inbox.filterFriends,
  "no-leidos": COPY.inbox.filterUnread,
};

/**
 * TODOS · AMIGOS · NO LEÍDOS.
 *
 * Chips que NAVEGAN (`?filtro=`) y no un estado de cliente, por las mismas tres
 * razones que el filtro por tema de Grupos: la pantalla sigue siendo un Server
 * Component que filtra donde están los datos, el filtro se puede compartir y el
 * back del sistema vuelve a donde estabas.
 *
 * No usa `<Chip>` de `ui` porque ese es un `<span>` decorativo: lo que hace
 * falta acá es un enlace con estado y 44px de área táctil (§3.2).
 *
 * `aria-current="page"` es el estado accesible; el color y el borde son la
 * versión visible del mismo hecho, nunca la única (WCAG 1.4.1).
 */
export function InboxFiltros({
  activo,
  noLeidos,
  ocultarNoLeidos = false,
}: {
  activo: FiltroDePersonas;
  /** Total sin leer. Sólo se dibuja en su chip y sólo si hay algo. */
  noLeidos: number;
  /** Sin `conversation_reads` el chip no se ofrece: ver la página. */
  ocultarNoLeidos?: boolean;
}) {
  const filtros = FILTROS_DE_PERSONAS.filter(
    (filtro) => !(ocultarNoLeidos && filtro === "no-leidos"),
  );

  return (
    <nav aria-label={COPY.inbox.filtersLabel} className="mb-4">
      <ul className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
        {filtros.map((filtro) => {
          const seleccionado = filtro === activo;
          const cuenta = filtro === "no-leidos" ? noLeidos : 0;
          return (
            <li key={filtro} className="shrink-0">
              <Link
                href={hrefDeFiltro(filtro)}
                aria-current={seleccionado ? "page" : undefined}
                scroll={false}
                className={cn(
                  "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full border px-4",
                  "text-sm font-medium",
                  // Sólo `color`/`background`/`border-color`: nada que dispare
                  // layout en un chip que vive dentro de un contenedor con
                  // scroll horizontal.
                  "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  seleccionado
                    ? "border-brand-strong bg-brand-tint text-brand-ink"
                    : "border-border-subtle bg-surface text-foreground-secondary hover:border-border-strong hover:text-foreground",
                )}
              >
                {ETIQUETA[filtro]}
                {cuenta > 0 && (
                  <span
                    className={cn(
                      "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5",
                      "text-[11px] font-bold leading-none tabular-nums",
                      seleccionado
                        ? "bg-brand text-brand-foreground"
                        : "bg-surface-subtle text-foreground-secondary",
                    )}
                  >
                    {cuenta > 99 ? "99+" : cuenta}
                    <span className="sr-only"> {COPY.inbox.unreadCount(cuenta)}</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
