"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isSearchable, sanitizeSearchQuery, type SearchPayload } from "./helpers";

/**
 * Estado de la búsqueda global.
 *
 * `browsing` no es "vacío": es la pantalla con historial y sugerencias. Tener
 * un nombre propio evita el estado mudo que el contrato prohíbe explícitamente
 * ("menos de 2 caracteres ⇒ que muestre el historial, no un vacío mudo").
 */
export type SearchStatus = "browsing" | "loading" | "ready" | "error";

/** Lo que espera el buscador antes de disparar. Ver el análisis abajo. */
export const SEARCH_DEBOUNCE_MS = 250;

export const SEARCH_ENDPOINT = "/buscar/api";

export interface UseGlobalSearchResult {
  status: SearchStatus;
  /** Último resultado exitoso. Se conserva mientras carga el siguiente. */
  payload: SearchPayload | null;
  /** true cuando hay una petición en vuelo Y ya había resultados en pantalla. */
  refreshing: boolean;
  retry: () => void;
}

/** Lo que devolvió el último intento resuelto, con la llave de a qué intento fue. */
interface Settled {
  query: string;
  attempt: number;
  status: "ready" | "error";
  payload: SearchPayload | null;
}

/**
 * Búsqueda global mientras se escribe.
 *
 * DEBOUNCE + CANCELACIÓN (los dos, no uno):
 *   · 250 ms de debounce ⇒ tipear "propiedades" dispara UNA búsqueda, no doce.
 *   · `AbortController` ⇒ si igual llegó a salir una petición y la persona
 *     siguió escribiendo, esa petición se ABORTA. Sin esto, la respuesta lenta
 *     de "pro" puede llegar después de la de "propiedades" y pisar en pantalla
 *     un resultado más nuevo con uno más viejo. El debounce solo no lo evita:
 *     achica la ventana, no la cierra.
 *   · Y encima un guard por `requestId`, porque `abort()` corta el transporte
 *     pero una promesa que ya resolvió puede seguir su camino igual.
 *
 * Menos de 2 caracteres NO llama a la red: la RPC ya devuelve vacío en ese caso
 * (`char_length(v_q) < 2`), así que el round-trip sería puro gasto.
 *
 * POR QUÉ EL ESTADO SE DERIVA Y NO SE GUARDA: lo único que se guarda es el
 * resultado del último intento RESUELTO, con la consulta a la que corresponde.
 * `status` sale de comparar esa llave con lo que hay escrito ahora. Guardar
 * `status` en su propio `useState` obligaría a un `setStatus("browsing")`
 * sincrónico dentro del efecto cada vez que se borra la barra — un render en
 * cascada en cada pulsación, que es exactamente lo que marca la regla
 * `react-hooks/set-state-in-effect`.
 */
export function useGlobalSearch(rawQuery: string): UseGlobalSearchResult {
  const query = sanitizeSearchQuery(rawQuery);
  const searchable = isSearchable(query);

  const [settled, setSettled] = useState<Settled | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    // Sin término buscable no hay nada que pedir. Se invalida lo que esté en
    // vuelo y se sale: el estado que ve la UI se deriva abajo, en el render.
    if (!searchable) {
      requestIdRef.current += 1;
      return;
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`buscar: ${response.status}`);
        const data = (await response.json()) as SearchPayload;
        if (requestIdRef.current !== requestId) return; // llegó tarde: se descarta
        setSettled({ query, attempt, status: "ready", payload: data });
      } catch (error) {
        // Abortar es el camino feliz de "la persona siguió escribiendo": no es
        // un error y no puede pintar la pantalla de error.
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (requestIdRef.current !== requestId) return;
        setSettled({ query, attempt, status: "error", payload: null });
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchable, attempt]);

  // ¿Lo guardado corresponde a lo que hay escrito AHORA (y a este intento)?
  const fresh =
    settled && settled.query === query && settled.attempt === attempt ? settled : null;

  const status: SearchStatus = !searchable ? "browsing" : (fresh?.status ?? "loading");

  // Mientras carga una consulta nueva se conserva el resultado ANTERIOR para
  // atenuarlo en vez de reemplazarlo por un esqueleto: cambiar contenido por
  // silueta en cada tecla es un parpadeo, no una carga.
  const payload = searchable ? (fresh?.payload ?? settled?.payload ?? null) : null;

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    status,
    payload,
    refreshing: status === "loading" && payload !== null,
    retry,
  };
}
