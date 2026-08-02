// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { CONSENT_STORAGE_KEY } from "./store";
import { clearLocalData, isClearable, listLocalData } from "./local-data";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("qué se puede borrar y qué NO", () => {
  it("NUNCA borra la sesión de Supabase", () => {
    // Este es el test que importa. Un `localStorage.clear()` descuidado en el
    // botón de "borrar preferencias" desloguearía a la persona de golpe, sin
    // que lo haya pedido, en una app donde tiene su vivienda y su trabajo.
    expect(isClearable("sb-abc123-auth-token")).toBe(false);
    expect(isClearable("sb-abc123-auth-token.0")).toBe(false);
  });

  it("NUNCA borra la decisión de privacidad", () => {
    // Borrarla haría que la app vuelva a preguntar como si nunca hubiera
    // respondido. Para eso está "Volver a preguntarme", que es explícito.
    expect(isClearable(CONSENT_STORAGE_KEY)).toBe(false);
  });

  it("no toca claves de otras aplicaciones del mismo dominio", () => {
    expect(isClearable("otra-app-token")).toBe(false);
    expect(isClearable("__next_debug_channel:abc")).toBe(false);
  });

  it("sí borra las preferencias declaradas", () => {
    expect(isClearable("cl-theme")).toBe(true);
    expect(isClearable("cl:buscar:historial:dominicanos:anon")).toBe(true);
    expect(isClearable("cl-guias-offline")).toBe(true);
    expect(isClearable("cl-pwa-install-dismissed")).toBe(true);
  });
});

describe("listar y borrar de verdad", () => {
  it("lista sólo lo borrable, con su tamaño", () => {
    window.localStorage.setItem("cl-theme", "dark");
    window.localStorage.setItem("sb-proj-auth-token", "no-me-toques");
    window.sessionStorage.setItem("cl-pwa-visit-counted", "1");

    const entries = listLocalData();
    const keys = entries.map((e) => e.key);

    expect(keys).toContain("cl-theme");
    expect(keys).toContain("cl-pwa-visit-counted");
    expect(keys).not.toContain("sb-proj-auth-token");
    expect(entries.find((e) => e.key === "cl-theme")?.size).toBe("dark".length);
  });

  it("borra las preferencias y deja la sesión intacta", () => {
    window.localStorage.setItem("cl-theme", "dark");
    window.localStorage.setItem("cl:buscar:historial:x:anon", '["abogado"]');
    window.localStorage.setItem("sb-proj-auth-token", "sesion-viva");
    window.localStorage.setItem(CONSENT_STORAGE_KEY, "{}");

    const removed = clearLocalData();

    expect(removed).toBe(2);
    expect(window.localStorage.getItem("cl-theme")).toBeNull();
    expect(window.localStorage.getItem("cl:buscar:historial:x:anon")).toBeNull();
    // Lo que NO se toca:
    expect(window.localStorage.getItem("sb-proj-auth-token")).toBe("sesion-viva");
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("{}");
  });

  it("borrar dos veces no rompe nada", () => {
    window.localStorage.setItem("cl-theme", "light");
    expect(clearLocalData()).toBe(1);
    expect(clearLocalData()).toBe(0);
  });

  it("el historial de búsqueda de CUALQUIER persona del teléfono se limpia", () => {
    // El cajón de la sesión anterior queda huérfano y es inalcanzable desde la
    // UI. En un teléfono compartido —el caso real de esta comunidad— ese
    // huérfano es el historial de otra persona.
    window.localStorage.setItem("cl:buscar:historial:dominicanos:uuid-1", '["cuarto barato"]');
    window.localStorage.setItem("cl:buscar:historial:dominicanos:uuid-2", '["abogado"]');

    expect(clearLocalData()).toBe(2);
    expect(listLocalData()).toEqual([]);
  });
});
