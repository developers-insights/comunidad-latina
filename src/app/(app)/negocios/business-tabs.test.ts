import { describe, expect, it } from "vitest";
import {
  BUSINESS_TAB_IDS,
  BUSINESS_TAB_LABELS,
  businessTabHref,
  parseBusinessTab,
} from "./business-tabs";

describe("parseBusinessTab", () => {
  it("reconoce las tres pestañas de la spec", () => {
    expect(parseBusinessTab("negocios")).toBe("negocios");
    expect(parseBusinessTab("publicaciones")).toBe("publicaciones");
    expect(parseBusinessTab("ofertas")).toBe("ofertas");
  });

  it("es insensible a mayúsculas y a espacios sobrantes", () => {
    expect(parseBusinessTab("  Ofertas  ")).toBe("ofertas");
    expect(parseBusinessTab("PUBLICACIONES")).toBe("publicaciones");
  });

  it("sin valor cae en el directorio — la pestaña canónica de /negocios", () => {
    expect(parseBusinessTab(undefined)).toBe("negocios");
  });

  it("un valor vacío, viejo o inventado también cae en el directorio, nunca revienta", () => {
    expect(parseBusinessTab("")).toBe("negocios");
    expect(parseBusinessTab("tiendas")).toBe("negocios");
    expect(parseBusinessTab("<script>")).toBe("negocios");
    // Un id de negocio pegado en el ?t= por error tampoco tiene que romper.
    expect(parseBusinessTab("9f1c6f2e-0f0a-4d0e-9a1b-6e3f7c2a1b44")).toBe("negocios");
  });
});

describe("businessTabHref", () => {
  it("el directorio es la URL canónica, sin query — no rompe los enlaces que ya existen", () => {
    expect(businessTabHref("negocios")).toBe("/negocios");
  });

  it("publicaciones y ofertas llevan su propio ?t=", () => {
    expect(businessTabHref("publicaciones")).toBe("/negocios?t=publicaciones");
    expect(businessTabHref("ofertas")).toBe("/negocios?t=ofertas");
  });

  it("ninguna pestaña se sirve como sub-ruta: /negocios/[id] queda sin competencia", () => {
    for (const tab of BUSINESS_TAB_IDS) {
      const href = businessTabHref(tab);
      expect(href.startsWith("/negocios")).toBe(true);
      // `/negocios/algo` sería una carpeta hermana de `[id]`; acá nunca pasa.
      expect(href.replace(/\?.*$/, "")).toBe("/negocios");
    }
  });

  it("ida y vuelta: el href de cada pestaña se vuelve a parsear como esa pestaña", () => {
    for (const tab of BUSINESS_TAB_IDS) {
      const query = businessTabHref(tab).split("?")[1];
      const raw = query ? new URLSearchParams(query).get("t") : undefined;
      expect(parseBusinessTab(raw ?? undefined)).toBe(tab);
    }
  });

  it("las tres pestañas tienen etiqueta en español", () => {
    for (const tab of BUSINESS_TAB_IDS) {
      expect(BUSINESS_TAB_LABELS[tab].length).toBeGreaterThan(0);
    }
  });
});
