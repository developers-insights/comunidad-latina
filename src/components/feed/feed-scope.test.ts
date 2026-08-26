import { describe, expect, it } from "vitest";
import {
  FEED_SCOPES,
  FEED_SCOPE_LABELS,
  feedScopeHref,
  parseFeedScope,
} from "./feed-scope";
import { FEED_TABS } from "./helpers";

/**
 * Lo que estos tests protegen es la URL, no la pintura. `/feed` a secas está
 * linkeada desde el bottom nav, el logo, cada círculo de módulo y media docena
 * de CTAs: el día que «Siguiendo» pase a ser el default sin que nadie lo
 * decida, todos esos enlaces cambian de significado en silencio.
 */

describe("parseFeedScope", () => {
  it("ofrece exactamente las dos mitades que pide la spec", () => {
    expect([...FEED_SCOPES]).toEqual(["para-ti", "siguiendo"]);
  });

  it("«Para ti» es el default de todo lo que no matchea", () => {
    for (const raw of [undefined, "", "   ", "inventado", "following", "todo"]) {
      expect(parseFeedScope(raw)).toBe("para-ti");
    }
  });

  it("acepta el valor con espacios o en mayúsculas — una URL copiada a mano", () => {
    expect(parseFeedScope("  SIGUIENDO ")).toBe("siguiendo");
    expect(parseFeedScope("Siguiendo")).toBe("siguiendo");
  });

  it("cada mitad tiene su etiqueta", () => {
    for (const scope of FEED_SCOPES) {
      expect(FEED_SCOPE_LABELS[scope].length).toBeGreaterThan(0);
    }
  });
});

describe("feedScopeHref", () => {
  it("«Para ti» sin vertical es la URL canónica, sin query", () => {
    expect(feedScopeHref("para-ti")).toBe("/feed");
    expect(feedScopeHref("para-ti", "para-ti")).toBe("/feed");
    expect(feedScopeHref("para-ti", null)).toBe("/feed");
  });

  it("preserva el vertical al cruzar de mitad", () => {
    expect(feedScopeHref("siguiendo", "negocios")).toBe("/feed?ver=siguiendo&tab=negocios");
    expect(feedScopeHref("para-ti", "negocios")).toBe("/feed?tab=negocios");
  });

  it("«Siguiendo» sin vertical lleva un solo parámetro", () => {
    expect(feedScopeHref("siguiendo")).toBe("/feed?ver=siguiendo");
  });

  it("los ids de scope no chocan con los de vertical", () => {
    // Salvo "para-ti", que es el mismo concepto en los dos ejes a propósito:
    // la URL canónica del feed. Si alguna vez coincidieran más, `?ver=` y
    // `?tab=` dejarían de ser dos preguntas distintas.
    const verticales = FEED_TABS.map((tab) => tab.id as string);
    const choques = FEED_SCOPES.filter((scope) => verticales.includes(scope));
    expect(choques).toEqual(["para-ti"]);
  });

  it("toda URL que genera vuelve a parsearse a la misma mitad", () => {
    for (const scope of FEED_SCOPES) {
      const href = feedScopeHref(scope, "eventos");
      const ver = new URL(href, "https://x.test").searchParams.get("ver");
      expect(parseFeedScope(ver ?? undefined)).toBe(scope);
    }
  });
});
