// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FeedModeToggle, esTabSocial } from "./feed-mode-toggle";
import { FEED_TABS } from "./helpers";

describe("esTabSocial", () => {
  it("solo los dos modos del feed social son sociales", () => {
    expect(esTabSocial("para-ti")).toBe(true);
    expect(esTabSocial("siguiendo")).toBe(true);
    expect(esTabSocial("propiedades")).toBe(false);
    expect(esTabSocial("negocios")).toBe(false);
    expect(esTabSocial("profesionales")).toBe(false);
    expect(esTabSocial("eventos")).toBe(false);
  });

  it("cubre todos los tabs del feed — un tab nuevo obliga a decidir acá", () => {
    // Si FEED_TABS suma un tab, este test falla hasta que alguien decida si es
    // social (muestra el conmutador) o vertical (no). La decisión no puede
    // tomarse sola por omisión.
    for (const tab of FEED_TABS) {
      expect(typeof esTabSocial(tab.id)).toBe("boolean");
    }
    expect(FEED_TABS.filter((tab) => esTabSocial(tab.id)).map((tab) => tab.id)).toEqual([
      "siguiendo",
      "para-ti",
    ]);
  });
});

describe("FeedModeToggle", () => {
  afterEach(cleanup);

  it("marca el modo activo con aria-current y linkea el otro", () => {
    render(<FeedModeToggle active="siguiendo" />);
    const siguiendo = screen.getByRole("link", { name: "Siguiendo" });
    const paraTi = screen.getByRole("link", { name: "Para ti" });
    expect(siguiendo.getAttribute("aria-current")).toBe("page");
    expect(paraTi.getAttribute("aria-current")).toBeNull();
    // "para-ti" es el feed pelado: sin query que ensucie el link.
    expect(paraTi.getAttribute("href")).toBe("/feed");
    expect(siguiendo.getAttribute("href")).toBe("/feed?tab=siguiendo");
  });

  it("en un tab vertical no renderiza nada", () => {
    const { container } = render(<FeedModeToggle active="eventos" />);
    expect(container.innerHTML).toBe("");
  });
});
