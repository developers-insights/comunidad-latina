// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchPayload } from "./helpers";
import { SEARCH_DEBOUNCE_MS, useGlobalSearch } from "./use-global-search";

/**
 * El corazón del "resultados mientras escribe": debounce + cancelación.
 * Se testea acá y no en un componente porque lo que puede fallar —una respuesta
 * vieja pisando a una nueva— no se ve en el DOM hasta que ya pasó.
 *
 * NOTA sobre timers: todo corre con timers falsos y se avanza a mano con
 * `advanceTimersByTimeAsync`, que también drena las microtareas. Por eso NO se
 * usa `waitFor` de testing-library en este archivo: espera con timers REALES y
 * con los falsos activos se queda colgado hasta el timeout del test.
 */

const payloadFor = (query: string): SearchPayload => ({ query, groups: [], total: 0 });

/** `fetch` falso que registra cada llamada con su señal de aborto. */
function mockFetch() {
  const calls: { url: string; signal: AbortSignal }[] = [];
  const resolvers: ((value: SearchPayload) => void)[] = [];

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, signal: init!.signal as AbortSignal });
    return new Promise<Response>((resolve, reject) => {
      init!.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
      resolvers.push((value) =>
        resolve({ ok: true, status: 200, json: async () => value } as Response),
      );
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, resolvers, fetchMock };
}

/** Deja pasar el debounce y drena las promesas que hayan quedado pendientes. */
async function settle(ms = SEARCH_DEBOUNCE_MS + 10) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useGlobalSearch", () => {
  it("no toca la red con menos de 2 caracteres (la RPC ya devolvería vacío)", async () => {
    const { fetchMock } = mockFetch();
    const { result, rerender } = renderHook(({ q }) => useGlobalSearch(q), {
      initialProps: { q: "" },
    });

    expect(result.current.status).toBe("browsing");

    rerender({ q: "a" });
    await settle(SEARCH_DEBOUNCE_MS * 4);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("browsing");
  });

  it("hace UNA sola búsqueda al tipear rápido, y con el término final", async () => {
    const { calls, resolvers } = mockFetch();
    const { result, rerender } = renderHook(({ q }) => useGlobalSearch(q), {
      initialProps: { q: "cu" },
    });

    // Tres teclas dentro de la ventana de debounce.
    rerender({ q: "cua" });
    await settle(100);
    rerender({ q: "cuar" });
    await settle(100);
    rerender({ q: "cuarto" });
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("q=cuarto");

    await act(async () => {
      resolvers[0](payloadFor("cuarto"));
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.payload?.query).toBe("cuarto");
  });

  it("ABORTA la petición anterior cuando la persona sigue escribiendo", async () => {
    const { calls } = mockFetch();
    const { rerender } = renderHook(({ q }) => useGlobalSearch(q), {
      initialProps: { q: "cuarto" },
    });

    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(false);

    rerender({ q: "cuarto barato" });
    await settle();

    expect(calls[0].signal.aborted).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("un abort NO pinta la pantalla de error (es el camino feliz)", async () => {
    const { resolvers } = mockFetch();
    const { result, rerender } = renderHook(({ q }) => useGlobalSearch(q), {
      initialProps: { q: "cuarto" },
    });

    await settle();
    rerender({ q: "cuarto barato" });
    await settle();

    expect(result.current.status).toBe("loading");

    await act(async () => {
      resolvers[1](payloadFor("cuarto barato"));
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.payload?.query).toBe("cuarto barato");
  });

  it("descarta una respuesta vieja que llega tarde y no pisa a la nueva", async () => {
    const { resolvers } = mockFetch();
    const { result, rerender } = renderHook(({ q }) => useGlobalSearch(q), {
      initialProps: { q: "cuarto" },
    });

    await settle();
    rerender({ q: "cuarto barato" });
    await settle();

    // La NUEVA responde primero…
    await act(async () => {
      resolvers[1](payloadFor("cuarto barato"));
    });
    // …y la vieja llega después: no puede ganar.
    await act(async () => {
      resolvers[0](payloadFor("cuarto"));
    });

    expect(result.current.payload?.query).toBe("cuarto barato");
    expect(result.current.status).toBe("ready");
  });

  it("vuelve a 'browsing' y limpia si se borra la barra", async () => {
    const { resolvers } = mockFetch();
    const { result, rerender } = renderHook(({ q }) => useGlobalSearch(q), {
      initialProps: { q: "cuarto" },
    });

    await settle();
    await act(async () => {
      resolvers[0](payloadFor("cuarto"));
    });
    expect(result.current.status).toBe("ready");

    rerender({ q: "" });
    expect(result.current.status).toBe("browsing");
    expect(result.current.payload).toBeNull();
  });

  it("una respuesta no-ok deja el estado de error, y Reintentar vuelve a pedir", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 502 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGlobalSearch("cuarto"));
    await settle();
    expect(result.current.status).toBe("error");

    await act(async () => {
      result.current.retry();
    });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
