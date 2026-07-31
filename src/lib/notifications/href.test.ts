import { describe, expect, it } from "vitest";
import { inboxHref, isInboxFilter, parseInboxQuery } from "./href";

describe("parseInboxQuery", () => {
  it("sin parámetros, la bandeja completa sin filtrar", () => {
    expect(parseInboxQuery({})).toEqual({ tab: "todas", filter: "todas" });
  });

  it("lee categoría y filtro válidos", () => {
    expect(parseInboxQuery({ c: "mensajes", f: "no-leidas" })).toEqual({
      tab: "mensajes",
      filter: "no-leidas",
    });
  });

  it("una categoría inventada NO llega a la query: cae en 'todas'", () => {
    expect(parseInboxQuery({ c: "'; drop table notifications; --" }).tab).toBe("todas");
    expect(parseInboxQuery({ c: "SOCIAL" }).tab).toBe("todas");
  });

  it("un filtro inventado cae en 'todas'", () => {
    expect(parseInboxQuery({ f: "urgentes" }).filter).toBe("todas");
  });

  it("con el parámetro repetido toma el primero", () => {
    expect(parseInboxQuery({ c: ["social", "pagos"] }).tab).toBe("social");
  });

  it("un valor larguísimo no rompe nada", () => {
    expect(parseInboxQuery({ c: "x".repeat(5000) }).tab).toBe("todas");
  });
});

describe("inboxHref", () => {
  it("los defaults NO se escriben: una sola dirección por pantalla", () => {
    expect(inboxHref({})).toBe("/notificaciones");
    expect(inboxHref({ tab: "todas", filter: "todas" })).toBe("/notificaciones");
  });

  it("escribe sólo lo que se aparta del default", () => {
    expect(inboxHref({ tab: "trabajos" })).toBe("/notificaciones?c=trabajos");
    expect(inboxHref({ filter: "importantes" })).toBe("/notificaciones?f=importantes");
    expect(inboxHref({ tab: "pagos", filter: "no-leidas" })).toBe(
      "/notificaciones?c=pagos&f=no-leidas",
    );
  });

  it("ida y vuelta: lo que se escribe se vuelve a leer igual", () => {
    const query = { tab: "propiedades", filter: "importantes" } as const;
    const url = new URL(inboxHref(query), "https://x.test");
    expect(parseInboxQuery(Object.fromEntries(url.searchParams))).toEqual(query);
  });

  it("el guard de filtros acepta sólo los tres", () => {
    expect(isInboxFilter("no-leidas")).toBe(true);
    expect(isInboxFilter("leidas")).toBe(false);
  });
});
