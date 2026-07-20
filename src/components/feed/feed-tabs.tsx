import Link from "next/link";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { FEED_TABS, type FeedTabId } from "./helpers";

const TAB_LABELS: Record<FeedTabId, string> = {
  "para-ti": COPY.tabs.paraTi,
  propiedades: COPY.tabs.propiedades,
  negocios: COPY.tabs.negocios,
  profesionales: COPY.tabs.profesionales,
  eventos: COPY.tabs.eventos,
};

/**
 * Acento por módulo (globals.css) para el underline del tab activo: cada
 * vertical con su color, en vez de un único `bg-brand`. El underline es
 * decorativo, así que el acento va en el fondo del subrayado; el TEXTO queda en
 * foreground para no arriesgar contraste (p. ej. el amarillo de Negocios).
 */
const TAB_ACCENT: Record<FeedTabId, string> = {
  "para-ti": "var(--accent-feed)",
  propiedades: "var(--accent-vivienda)",
  negocios: "var(--accent-negocios)",
  profesionales: "var(--accent-profesionales)",
  eventos: "var(--accent-eventos)",
};

/**
 * Tabs de los 5 feeds (§4.b): scroll horizontal, tab activo con underline del
 * acento de su módulo. El estado vive en la URL (?tab=) — server component
 * puro, cero JS en el cliente.
 */
export function FeedTabs({ active }: { active: FeedTabId }) {
  return (
    <nav aria-label={COPY.tabs.ariaLabel} className="-mx-4 border-b border-border-subtle">
      <ul className="flex overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FEED_TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                href={tab.id === "para-ti" ? "/feed" : `/feed?tab=${tab.id}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex min-h-11 items-center whitespace-nowrap px-3.5 pb-2.5 pt-2 text-sm font-semibold",
                  "transition-colors duration-(--duration-fast)",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  isActive
                    ? "text-foreground"
                    : "text-foreground-muted hover:text-foreground-secondary",
                )}
              >
                {TAB_LABELS[tab.id]}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-3 bottom-0 h-0.5 rounded-full"
                    style={{ backgroundColor: TAB_ACCENT[tab.id] }}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
