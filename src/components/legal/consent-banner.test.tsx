// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CONSENT_STORAGE_KEY, hasConsent, readConsent } from "@/lib/consent";
import { ConsentBanner } from "./consent-banner";

/**
 * Las DOS conductas que tienen que ser ciertas a la vez:
 *   · hoy el banner NO existe, porque no hay nada que consentir;
 *   · en cuanto haya algo, aparece solo — sin que nadie lo encienda a mano.
 *
 * Sin el segundo test, el primero sería la excusa perfecta para no tener
 * consentimiento: "es que no hace falta". El segundo prueba que el día que
 * haga falta, funciona.
 */

beforeEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.resetModules();
});

describe("hoy: sin trazadores de opt-in, no hay banner", () => {
  it("no pinta nada", () => {
    const { container } = render(<ConsentBanner />);
    expect(container.textContent).toBe("");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("no molesta con un cartel que no tiene nada que pedir", () => {
    render(<ConsentBanner />);
    expect(screen.queryByText(/Aceptar todo/i)).toBeNull();
    expect(screen.queryByText(/Rechazar todo/i)).toBeNull();
  });
});

describe("mañana: con un trazador de analítica, el banner aparece solo", () => {
  /** Se agrega una fila al registro; NADA MÁS. El banner no se toca. */
  async function renderConAnalitica() {
    vi.doMock("@/lib/consent/categories", async () => {
      const real = await vi.importActual<typeof import("@/lib/consent/categories")>(
        "@/lib/consent/categories",
      );
      const extra = {
        name: "_ga",
        kind: "cookie" as const,
        category: "analitica" as const,
        owner: "Google",
        firstParty: false,
        purpose: "Medir visitas.",
        duration: "2 años",
      };
      const TRACKERS = [...real.TRACKERS, extra];
      return {
        ...real,
        TRACKERS,
        trackersOf: (c: string) => TRACKERS.filter((t) => t.category === c),
        categoriesNeedingConsent: () => ["analitica"],
      };
    });

    const { ConsentBanner: Banner } = await import("./consent-banner");
    return render(<Banner />);
  }

  it("se muestra, con rol de diálogo y su etiqueta", async () => {
    await renderConAnalitica();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-label")).toMatch(/privacidad/i);
  });

  it("rechazar y aceptar están al MISMO nivel y a un solo clic", async () => {
    await renderConAnalitica();
    const aceptar = await screen.findByRole("button", { name: "Aceptar todo" });
    const rechazar = await screen.findByRole("button", { name: "Rechazar todo" });

    // Hermanos dentro del mismo contenedor: rechazar no está escondido un nivel
    // más abajo ni detrás de "Preferencias". Es lo que multan las autoridades.
    expect(aceptar.parentElement).toBe(rechazar.parentElement);
    // Y ambos son botones directos, no enlaces a otra pantalla.
    expect(rechazar.tagName).toBe("BUTTON");
  });

  it("rechazar guarda la decisión y no concede analítica", async () => {
    await renderConAnalitica();
    fireEvent.click(await screen.findByRole("button", { name: "Rechazar todo" }));

    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).not.toBeNull();
    expect(readConsent()).not.toBeNull();
    expect(hasConsent("analitica")).toBe(false);
  });

  it("aceptar concede, y queda registrado CUÁNDO", async () => {
    await renderConAnalitica();
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar todo" }));

    expect(hasConsent("analitica")).toBe(true);
    const record = readConsent();
    expect(Number.isNaN(Date.parse(record?.decidedAt ?? ""))).toBe(false);
  });

  it("Escape NO acepta: cerrar un aviso nunca es decir que sí", async () => {
    await renderConAnalitica();
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(hasConsent("analitica")).toBe(false);
  });

  it("una vez decidido, no vuelve a aparecer", async () => {
    await renderConAnalitica();
    fireEvent.click(await screen.findByRole("button", { name: "Rechazar todo" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
