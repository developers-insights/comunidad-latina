// @vitest-environment jsdom

/**
 * El entorno de tests tiene que darle a jsdom su `localStorage` de verdad.
 *
 * Este test existe porque durante un tiempo **no lo tuvo**: Node 26 instala un
 * accessor `localStorage` sobre `globalThis` cuyo getter devuelve `undefined`
 * sin `--localstorage-file`, y como en jsdom `window === globalThis`, tapaba al
 * de jsdom. 88 tests de consentimiento, tema y legales morían en su `beforeEach`
 * con "Cannot read properties of undefined", y el diagnóstico llevó a mirar el
 * código de la app en vez del runner. El arreglo vive en `vitest.config.ts`.
 *
 * Cada expectativa de acá es algo de lo que depende código de producción:
 * `lib/consent/local-data.ts` lista lo borrable con `Object.keys(storage)`, y
 * `components/theme/theme-store.test.ts` espía `Storage.prototype.setItem` —
 * cosa que sólo funciona si el objeto es un `Storage` real y no un reemplazo.
 */

import { beforeEach, describe, expect, it } from "vitest";

describe("contrato: localStorage en el entorno de tests", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("existe y es un Storage de jsdom, no un stub inerte del runtime", () => {
    expect(window.localStorage).toBeDefined();
    expect(window.localStorage).toBeInstanceOf(Storage);
    expect(window.sessionStorage).toBeInstanceOf(Storage);
  });

  it("guarda, lee y borra", () => {
    window.localStorage.setItem("cl-prueba", "valor");
    expect(window.localStorage.getItem("cl-prueba")).toBe("valor");
    expect(window.localStorage.length).toBe(1);

    window.localStorage.removeItem("cl-prueba");
    expect(window.localStorage.getItem("cl-prueba")).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("expone las claves como propiedades enumerables — de esto vive `listLocalData()`", () => {
    window.localStorage.setItem("cl-theme", "dark");
    window.localStorage.setItem("cl-consent", "{}");
    expect(Object.keys(window.localStorage).sort()).toEqual(["cl-consent", "cl-theme"]);
  });

  it("local y session son almacenes distintos — borrar preferencias no toca la sesión", () => {
    window.localStorage.setItem("misma-clave", "local");
    window.sessionStorage.setItem("misma-clave", "session");
    expect(window.localStorage.getItem("misma-clave")).toBe("local");
    expect(window.sessionStorage.getItem("misma-clave")).toBe("session");
  });
});
