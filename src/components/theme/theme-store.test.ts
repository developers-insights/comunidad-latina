// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY } from "./constants";

/**
 * El store es un módulo con estado singleton: cada test lo importa de cero.
 *
 * Lo que se protege acá es el camino que NADIE ejercita a mano: `localStorage`
 * que lanza. Pasa de verdad en Chrome/Edge con "bloquear todos los datos de
 * sitios", en Firefox con cookies en "bloquear todo", y en un iframe cross-origin
 * con storage particionado denegado. Sin fallback en memoria el toggle era un
 * botón MUERTO: `setTheme()` escribía, fallaba en silencio, e inmediatamente
 * `refreshSnapshot()` volvía a LEER el storage — descartando el argumento— y
 * recalculaba 'system'. El snapshot quedaba idéntico, así que ni el DOM ni
 * `aria-pressed` se movían.
 */

type Store = typeof import("./theme-store");

function stubMatchMedia(systemDark: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: systemDark,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** SecurityError: en estos navegadores lanza TODO acceso, no sólo la escritura. */
function blockStorage(): void {
  const boom = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
}

const themeClass = () => document.documentElement.className;

beforeEach(() => {
  vi.resetModules();
  document.documentElement.className = "";
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("theme-store con localStorage funcionando", () => {
  it("el toggle alterna, persiste y estampa la clase", async () => {
    stubMatchMedia(false);
    const store: Store = await import("./theme-store");

    expect(store.getSnapshot()).toEqual({ theme: "system", resolvedTheme: "light" });

    store.toggleTheme();
    expect(store.getSnapshot()).toEqual({ theme: "dark", resolvedTheme: "dark" });
    expect(themeClass()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    store.toggleTheme();
    expect(store.getSnapshot()).toEqual({ theme: "light", resolvedTheme: "light" });
    expect(themeClass()).toBe("light");
  });

  it("el storage sigue mandando: otra pestaña puede volver a 'system'", async () => {
    stubMatchMedia(true); // SO en dark
    const store: Store = await import("./theme-store");

    store.setTheme("light");
    expect(store.getSnapshot().resolvedTheme).toBe("light");

    // Otra pestaña hizo setTheme('system') → removeItem.
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    expect(store.getSnapshot()).toEqual({ theme: "light", resolvedTheme: "light" });

    // El snapshot es cacheado hasta que algo lo invalida; el evento `storage` lo hace.
    const unsubscribe = store.subscribe(() => {});
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    expect(store.getSnapshot()).toEqual({ theme: "system", resolvedTheme: "dark" });
    unsubscribe();
  });
});

describe("theme-store con localStorage bloqueado (SecurityError en todo acceso)", () => {
  it("arranca siguiendo al SO, sin romper", async () => {
    stubMatchMedia(true);
    blockStorage();
    const store: Store = await import("./theme-store");
    expect(store.getSnapshot()).toEqual({ theme: "system", resolvedTheme: "dark" });
  });

  it("el toggle NO es un botón muerto: el tema cambia igual", async () => {
    stubMatchMedia(false); // SO en light
    blockStorage();
    const store: Store = await import("./theme-store");

    store.toggleTheme();
    expect(store.getSnapshot()).toEqual({ theme: "dark", resolvedTheme: "dark" });
    expect(themeClass()).toBe("dark");

    store.toggleTheme();
    expect(store.getSnapshot()).toEqual({ theme: "light", resolvedTheme: "light" });
    expect(themeClass()).toBe("light");
  });
});

describe("theme-store con localStorage sin cuota (setItem lanza, getItem anda)", () => {
  it("no revierte al valor viejo del storage", async () => {
    stubMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });

    const store: Store = await import("./theme-store");
    expect(store.getSnapshot().theme).toBe("light");

    store.setTheme("dark"); // setItem lanza; getItem seguiría devolviendo "light"
    expect(store.getSnapshot()).toEqual({ theme: "dark", resolvedTheme: "dark" });
    expect(themeClass()).toBe("dark");
  });

  it("cuando la escritura vuelve a funcionar, el storage retoma el mando", async () => {
    stubMatchMedia(true);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });

    const store: Store = await import("./theme-store");
    store.setTheme("light"); // falla la escritura → manda la memoria
    expect(store.getSnapshot().theme).toBe("light");

    store.setTheme("dark"); // ahora sí persiste
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(store.getSnapshot()).toEqual({ theme: "dark", resolvedTheme: "dark" });
  });
});

describe("applyToDocument", () => {
  it("es exportada: hay que reafirmar la clase tras un remonte de <html>", async () => {
    stubMatchMedia(false);
    const store: Store = await import("./theme-store");

    // React borra TODOS los atributos de <html> al re-adquirir el singleton
    // (acquireSingletonInstance), p. ej. al volver del global-error boundary.
    store.setTheme("dark");
    document.documentElement.className = "__font_abc h-full antialiased";

    store.applyToDocument("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("__font_abc")).toBe(true);
  });
});
