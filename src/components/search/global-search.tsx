"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MagnifyingGlass, SmileyMeh, WarningCircle, X } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { announceResults, isSearchable, sanitizeSearchQuery } from "./helpers";
import {
  addToHistory,
  clearStoredHistory,
  dropFromHistory,
  historySnapshot,
  serverHistorySnapshot,
  subscribeHistory,
} from "./history";
import { SearchHistory, SearchSuggestions } from "./search-history";
import { SearchResults, SearchResultsSkeleton } from "./search-results";
import { buildSuggestions } from "./suggestions";
import { useGlobalSearch } from "./use-global-search";

export interface GlobalSearchProps {
  /**
   * Clave de `localStorage` del historial, ya namespaceada por tenant y persona
   * en el servidor. Ver el bloque de arriba de `history.ts`: un historial de
   * búsquedas es dato sensible y en un teléfono compartido no puede ser global.
   */
  historyKey: string;
  /** Zonas reales de los avisos publicados del tenant, para las sugerencias. */
  zones?: readonly string[];
  className?: string;
}

/**
 * Barra de búsqueda global de /buscar + panel de resultados en vivo.
 *
 * ISLA CLIENTE, no la página: /buscar sigue siendo un Server Component que
 * pinta su grilla de módulos sin JS. Sólo esta pieza es interactiva.
 *
 * LOS CINCO ESTADOS, TODOS DISEÑADOS (ninguno es un texto suelto):
 *   · barra vacía        → historial (o, si no hay, qué va a aparecer ahí);
 *   · 1 carácter         → sugerencias reales + historial (nunca un vacío mudo);
 *   · cargando           → silueta de los resultados la PRIMERA vez; si ya había
 *     resultados en pantalla, se atenúan en lugar de reemplazarse por un
 *     esqueleto. Cambiar contenido por silueta en cada tecla es un parpadeo, no
 *     una carga;
 *   · sin resultados     → qué probar, con sugerencias reales al lado;
 *   · error              → mensaje cálido que no culpa a nadie + Reintentar.
 *
 * TECLADO: ↓/↑ recorren las filas (foco DOM real sobre los links y botones, no
 * `aria-activedescendant`: así cada fila conserva su semántica de enlace y el
 * lector de pantalla dice "enlace"), Enter desde la barra baja al primer
 * resultado, Escape borra y, si ya está vacío, devuelve el foco a la barra.
 */
export function GlobalSearch({ historyKey, zones = [], className }: GlobalSearchProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { status, payload, refreshing, retry } = useGlobalSearch(value);

  // `localStorage` es un sistema EXTERNO a React y así es como React manda
  // leerlo: el snapshot del servidor va vacío (allá no hay historial que
  // renderizar) y el del cliente trae el real. Ver el bloque del store en
  // history.ts para por qué no es un useState + useEffect.
  const history = useSyncExternalStore(
    subscribeHistory,
    () => historySnapshot(historyKey),
    serverHistorySnapshot,
  );

  /**
   * Guarda el término en el historial. Se llama cuando la persona ELIGIÓ algo
   * (abrió un resultado, bajó con Enter, entró al listado de un módulo) y no en
   * cada pulsación: si no, el historial se llenaría de prefijos —"c", "cu",
   * "cua"— y las ocho ranuras no guardarían ni una búsqueda completa.
   */
  const commit = useCallback(
    (term: string) => {
      const clean = sanitizeSearchQuery(term);
      if (!isSearchable(clean)) return;
      addToHistory(historyKey, clean);
    },
    [historyKey],
  );

  const removeTerm = useCallback(
    (term: string) => dropFromHistory(historyKey, term),
    [historyKey],
  );

  const clearAll = useCallback(() => clearStoredHistory(historyKey), [historyKey]);

  const pick = useCallback((term: string) => {
    setValue(term);
    inputRef.current?.focus();
  }, []);

  const suggestions = useMemo(
    () => buildSuggestions(value, { zones, history }),
    [value, zones, history],
  );

  const browsing = status === "browsing";
  const groups = payload?.groups ?? [];
  const emptyResult = status === "ready" && groups.length === 0;

  /** Filas navegables del panel, en el orden en que se ven. */
  const rows = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[data-search-item]") ?? []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (value.length > 0) setValue("");
      inputRef.current?.focus();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;

    const items = rows();
    if (items.length === 0) return;
    const fromInput = event.target === inputRef.current;
    const index = fromInput ? -1 : items.indexOf(event.target as HTMLElement);

    // Enter dentro de una fila la activa sola (es un link o un botón): no lo
    // interceptamos. Desde la barra, baja al primer resultado en vez de
    // navegar solo — abrir algo que la persona no eligió es una sorpresa cara.
    if (event.key === "Enter") {
      if (!fromInput) return;
      event.preventDefault();
      commit(value);
      items[0]?.focus();
      return;
    }

    event.preventDefault();
    if (event.key === "ArrowDown") {
      items[Math.min(index + 1, items.length - 1)]?.focus();
      return;
    }
    // ArrowUp desde la primera fila vuelve a la barra: el camino de ida y el de
    // vuelta tienen que ser el mismo.
    if (index <= 0) inputRef.current?.focus();
    else items[index - 1]?.focus();
  }

  return (
    <div className={cn(className)} onKeyDown={onKeyDown}>
      {/* Sticky bajo el header del shell (h-14 + 3px de la barra de acento):
          la barra queda visible mientras se recorren los resultados, que es
          justo cuando hace falta corregir lo que se escribió. El fondo `canvas`
          a sangre (-mx-4 px-4) evita que el contenido asome por los costados
          al pasar por debajo. */}
      <div
        role="search"
        className="sticky top-[59px] z-30 -mx-4 bg-canvas px-4 pb-3 pt-1"
      >
        {/* Double-bezel (§5): carcasa mate + núcleo concéntrico. Le da a la
            barra el mismo peso físico que las tarjetas de confianza. */}
        <div className="rounded-2xl bg-surface-subtle p-1.5 ring-1 ring-border-subtle">
          <div className="relative">
            <MagnifyingGlass
              aria-hidden="true"
              size={20}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-muted"
            />
            <input
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label={t("sections", "searchBarLabel")}
              aria-describedby="buscar-anuncio"
              placeholder={t("sections", "searchBarPlaceholder")}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={cn(
                "h-12 w-full rounded-xl border-0 bg-surface pl-11 pr-12 text-base text-foreground",
                "placeholder:text-placeholder",
                "shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-white)_60%,transparent)]",
                "transition-shadow duration-(--duration-fast) ease-(--ease-out-premium)",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                // WebKit dibuja su propia "x" en type=search: sin ocultarla
                // quedan dos botones de borrar superpuestos.
                "[&::-webkit-search-cancel-button]:hidden",
              )}
            />
            {value.length > 0 && (
              <button
                type="button"
                aria-label={t("sections", "searchBarClear")}
                onClick={() => {
                  setValue("");
                  inputRef.current?.focus();
                }}
                className={cn(
                  "absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full",
                  "text-foreground-muted transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
                  "hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                <X aria-hidden="true" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cuántos resultados y de qué tipo, para quien no ve la pantalla. Es la
          única señal de que algo pasó al escribir: sin esto, la búsqueda en
          vivo es literalmente muda con lector de pantalla. `polite` y nunca
          `assertive` — no puede interrumpir lo que se está tipeando. */}
      <p id="buscar-anuncio" role="status" aria-live="polite" className="sr-only">
        {status === "ready" ? announceResults(groups) : ""}
      </p>

      <div ref={panelRef} aria-busy={status === "loading"}>
        {browsing && (
          <>
            <SearchSuggestions suggestions={suggestions} onPick={pick} />
            <SearchHistory
              history={history}
              onPick={pick}
              onRemove={removeTerm}
              onClearAll={clearAll}
            />
          </>
        )}

        {status === "loading" && !refreshing && <SearchResultsSkeleton />}

        {(status === "ready" || refreshing) && groups.length > 0 && (
          <SearchResults
            groups={groups}
            query={payload?.query ?? value}
            onNavigate={() => commit(value)}
            className={cn(
              "transition-opacity duration-(--duration-fast) ease-(--ease-out-premium)",
              refreshing && "opacity-60",
            )}
          />
        )}

        {emptyResult && (
          <div className="rounded-xl bg-surface p-5 ring-1 ring-border-subtle">
            <span
              aria-hidden="true"
              className="mb-3 flex size-12 items-center justify-center rounded-full bg-surface-subtle text-foreground-muted"
            >
              <SmileyMeh size={26} weight="light" />
            </span>
            <p className="font-display text-base font-semibold text-foreground">
              {t("sections", "searchNoResultsTitle")}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
              {t("sections", "searchNoResultsMessage")}
            </p>
            {/* Las sugerencias valen justo acá: no encontramos nada, pero esto
                otro sí existe en la comunidad. */}
            {suggestions.length > 0 && (
              <div className="mt-4 border-t border-border-subtle pt-3">
                <SearchSuggestions suggestions={suggestions} onPick={pick} />
              </div>
            )}
          </div>
        )}

        {status === "error" && (
          <div className="rounded-xl bg-surface p-5 ring-1 ring-border-subtle">
            <span
              aria-hidden="true"
              className="mb-3 flex size-12 items-center justify-center rounded-full bg-warning-bg text-warning-ink"
            >
              <WarningCircle size={26} weight="light" />
            </span>
            <p className="font-display text-base font-semibold text-foreground">
              {t("sections", "searchErrorTitle")}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
              {t("sections", "searchErrorMessage")}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={retry}>
              {t("sections", "searchErrorRetry")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
