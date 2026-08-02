// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CATEGORY_META, acceptAll, hasConsent, readConsent } from "@/lib/consent";
import { __resetListeners } from "@/lib/consent/store";
import { ConsentPreferences } from "./consent-preferences";

beforeEach(() => {
  window.localStorage.clear();
  __resetListeners();
  cleanup();
  vi.restoreAllMocks();
});

function Harness() {
  return <ConsentPreferences open onClose={() => {}} />;
}

describe("la pantalla dice la verdad sobre cada categoría", () => {
  it("muestra las cuatro categorías con su etiqueta humana", () => {
    render(<Harness />);
    for (const meta of Object.values(CATEGORY_META)) {
      expect(screen.getByText(meta.label)).toBeTruthy();
    }
  });

  it("lo imprescindible NO es un interruptor apagado, es 'Siempre'", () => {
    // Un switch deshabilitado invita a intentar tocarlo y sugiere que se podría
    // apagar. "Siempre" dice la verdad: esto no se negocia.
    render(<Harness />);
    expect(screen.getByText("Siempre")).toBeTruthy();
    expect(
      screen.queryByRole("switch", { name: CATEGORY_META.necesarias.label }),
    ).toBeNull();
  });

  it("analítica y marketing se muestran vacías, no como si guardaran algo", () => {
    render(<Harness />);
    const vacias = screen.getAllByText("Hoy no guardamos nada de esto");
    // Al menos las dos categorías de opt-in, que hoy no tienen trazadores.
    expect(vacias.length).toBeGreaterThanOrEqual(2);
  });

  it("las categorías de opt-in arrancan en 'No'", () => {
    render(<Harness />);
    const analitica = screen.getByRole("switch", { name: CATEGORY_META.analitica.label });
    expect(analitica.getAttribute("aria-checked")).toBe("false");
  });
});

describe("guardar", () => {
  it("un interruptor cambia y se guarda", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("switch", { name: CATEGORY_META.analitica.label }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(hasConsent("analitica")).toBe(true));
  });

  it("guardar SIN tocar nada no revierte lo que ya estaba concedido", async () => {
    // Regresión: el borrador arrancaba con una copia de los permisos del
    // momento del montaje. Si algo cambiaba después, abrir y tocar "Guardar"
    // sin mover un dedo escribía esa foto vieja y apagaba permisos vigentes.
    acceptAll();
    expect(hasConsent("analitica")).toBe(true);

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(readConsent()).not.toBeNull());
    expect(hasConsent("analitica")).toBe(true);
    expect(hasConsent("marketing")).toBe(true);
  });

  it("cancelar no guarda nada", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("switch", { name: CATEGORY_META.analitica.label }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(readConsent()).toBeNull();
    expect(hasConsent("analitica")).toBe(false);
  });
});
