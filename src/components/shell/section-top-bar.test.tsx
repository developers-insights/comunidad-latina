// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * Lo que prueba este archivo es el CONTRATO de la salida, no el dibujo:
 *
 *  · con historial de la app detrás, "Volver" retrocede de verdad (vuelve a la
 *    pantalla de la que vino, que puede ser cualquiera);
 *  · sin historial —link compartido, PWA recién abierta— navega al fallback en
 *    vez de tirar a la persona fuera de la app;
 *  · un wizard puede quedarse con el gesto para retroceder UN paso.
 *
 * `internal-history` se mockea porque su propia decisión ya está probada en
 * `internal-history.test.ts`; acá interesa qué hace la barra con cada respuesta.
 */

const nav = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
const historia = vi.hoisted(() => ({ hay: false }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: nav.back, push: nav.push }),
}));

vi.mock("./internal-history", () => ({
  hasInternalHistory: () => historia.hay,
  markInternalNavigation: vi.fn(),
}));

import { SectionTopBar } from "./section-top-bar";

beforeEach(() => {
  nav.back.mockClear();
  nav.push.mockClear();
  historia.hay = false;
});

afterEach(cleanup);

const volver = () => screen.getByRole("button", { name: "Volver" });

describe("SectionTopBar", () => {
  it("con historial de la app detrás, retrocede", () => {
    historia.hay = true;
    render(<SectionTopBar fallbackHref="/empleos" />);

    fireEvent.click(volver());

    expect(nav.back).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("sin historial, va al fallback de la pantalla en vez de salir de la app", () => {
    render(<SectionTopBar fallbackHref="/empleos" />);

    fireEvent.click(volver());

    expect(nav.push).toHaveBeenCalledWith("/empleos");
    expect(nav.back).not.toHaveBeenCalled();
  });

  it("un wizard se queda con el gesto: onBack true retrocede un paso y no navega", () => {
    historia.hay = true;
    const paso = vi.fn(() => true);
    render(<SectionTopBar fallbackHref="/empleos" onBack={paso} />);

    fireEvent.click(volver());

    expect(paso).toHaveBeenCalledTimes(1);
    expect(nav.back).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("en el primer paso el wizard devuelve false y ahí sí se sale del flujo", () => {
    const paso = vi.fn(() => false);
    render(<SectionTopBar fallbackHref="/empleos" onBack={paso} />);

    fireEvent.click(volver());

    expect(nav.push).toHaveBeenCalledWith("/empleos");
  });

  it("el texto 'Volver' se lee, no depende del ícono", () => {
    render(<SectionTopBar fallbackHref="/buscar" />);
    expect(volver().textContent).toContain("Volver");
  });

  it("el título es texto, no un segundo <h1> que compita con el de la página", () => {
    render(<SectionTopBar fallbackHref="/videos" title="Videos largos" />);

    expect(screen.getByText("Videos largos")).toBeDefined();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("la ranura derecha renderiza las acciones de la pantalla", () => {
    render(
      <SectionTopBar
        fallbackHref="/perfil"
        actions={<button type="button">Guardar</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Guardar" })).toBeDefined();
  });
});
