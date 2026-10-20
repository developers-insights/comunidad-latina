// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { canalScriptSource } from "./canal-app";

function correrScript() {
  new Function(canalScriptSource)();
}

describe("canalScriptSource", () => {
  afterEach(() => {
    sessionStorage.clear();
    document.documentElement.removeAttribute("data-canal");
    window.history.replaceState(null, "", "/");
  });

  it("marca la app de Android cuando la TWA abre con ?origen=android", () => {
    window.history.replaceState(null, "", "/feed?origen=android");
    correrScript();
    expect(document.documentElement.getAttribute("data-canal")).toBe("android");
  });

  it("sigue marcada en las navegaciones siguientes de la misma pestaña", () => {
    window.history.replaceState(null, "", "/feed?origen=android");
    correrScript();
    document.documentElement.removeAttribute("data-canal");
    window.history.replaceState(null, "", "/verificacion");
    correrScript();
    expect(document.documentElement.getAttribute("data-canal")).toBe("android");
  });

  it("no toca nada en el navegador normal", () => {
    window.history.replaceState(null, "", "/verificacion");
    correrScript();
    expect(document.documentElement.hasAttribute("data-canal")).toBe(false);
  });
});
