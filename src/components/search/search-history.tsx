"use client";

import { ClockCounterClockwise, MagnifyingGlass, X } from "@phosphor-icons/react/dist/ssr";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { SearchSuggestion } from "./suggestions";

const rowClass = cn(
  "flex min-h-11 flex-1 items-center gap-2.5 rounded-md px-2 text-left",
  "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
  "hover:bg-surface-hover",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

/**
 * Historial de búsquedas — visible SÓLO con la barra vacía.
 *
 * Es lo que hace que abrir /buscar no sea una pantalla muda: lo primero que se
 * ve es lo que esa persona ya buscó, a un toque. Cada fila se puede quitar sola
 * y están todas juntas bajo "Borrar todo", porque una búsqueda anterior puede
 * ser algo que alguien no quiere que se le quede en el teléfono.
 *
 * Dos acciones por fila ⇒ dos botones HERMANOS, nunca uno adentro del otro:
 * un `<button>` anidado es HTML inválido y en la práctica hace que el lector de
 * pantalla anuncie un solo control con dos nombres.
 */
export function SearchHistory({
  history,
  onPick,
  onRemove,
  onClearAll,
}: {
  history: readonly string[];
  onPick: (term: string) => void;
  onRemove: (term: string) => void;
  onClearAll: () => void;
}) {
  if (history.length === 0) {
    return (
      <p className="px-2 py-3 text-sm leading-relaxed text-foreground-secondary">
        {t("sections", "searchHistoryEmpty")}
      </p>
    );
  }

  return (
    <section aria-labelledby="buscar-historial">
      <div className="mb-1 flex items-center justify-between gap-2 px-2">
        <h3
          id="buscar-historial"
          className="text-xs font-semibold uppercase tracking-wide text-foreground-muted"
        >
          {t("sections", "searchHistoryTitle")}
        </h3>
        <button
          type="button"
          onClick={onClearAll}
          className={cn(
            "-mr-2 min-h-11 rounded-full px-3 text-xs font-semibold text-foreground-secondary",
            "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
            "hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          {t("sections", "searchHistoryClear")}
        </button>
      </div>

      <ul className="flex flex-col">
        {history.map((term) => (
          <li key={term} className="flex items-center gap-1">
            <button
              type="button"
              data-search-item=""
              onClick={() => onPick(term)}
              className={rowClass}
            >
              <ClockCounterClockwise
                aria-hidden="true"
                size={18}
                className="shrink-0 text-foreground-muted"
              />
              <span className="truncate text-sm text-foreground">{term}</span>
            </button>
            <button
              type="button"
              aria-label={t("sections", "searchHistoryRemove", { term })}
              onClick={() => onRemove(term)}
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-muted",
                "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
                "hover:bg-surface-hover hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
            >
              <X aria-hidden="true" size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Sugerencias mientras se escribe. Salen de datos REALES que ya están en
 * memoria (zonas de los avisos publicados, taxonomías de los módulos) y del
 * historial — nunca de un "lo más buscado" inventado (ver `suggestions.ts`).
 */
export function SearchSuggestions({
  suggestions,
  onPick,
}: {
  suggestions: readonly SearchSuggestion[];
  onPick: (term: string) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <section aria-labelledby="buscar-sugerencias" className="mb-4">
      <h3
        id="buscar-sugerencias"
        className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted"
      >
        {t("sections", "searchSuggestionsTitle")}
      </h3>
      <ul className="flex flex-col">
        {suggestions.map((suggestion) => (
          <li key={`${suggestion.kind}:${suggestion.term}`}>
            <button
              type="button"
              data-search-item=""
              onClick={() => onPick(suggestion.term)}
              className={cn(rowClass, "w-full")}
            >
              {suggestion.kind === "historial" ? (
                <ClockCounterClockwise
                  aria-hidden="true"
                  size={18}
                  className="shrink-0 text-foreground-muted"
                />
              ) : (
                <MagnifyingGlass
                  aria-hidden="true"
                  size={18}
                  className="shrink-0 text-foreground-muted"
                />
              )}
              <span className="truncate text-sm text-foreground">{suggestion.term}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
