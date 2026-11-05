/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn(), pathname: "/feed" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));

import { PhoneGateBanner } from "./phone-gate-banner";

beforeEach(() => {
  mocks.push.mockClear();
  mocks.pathname = "/feed";
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe("PhoneGateBanner", () => {
  it("al entrar lleva a verificar una sola vez, y guarda a dónde volver", () => {
    const { rerender } = render(<PhoneGateBanner status="pendiente" />);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/ajustes/telefono?next=%2F");

    rerender(<PhoneGateBanner status="pendiente" />);
    cleanup();
    render(<PhoneGateBanner status="pendiente" />);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it("el aviso queda aunque haya pasado por la pantalla", () => {
    window.sessionStorage.setItem("cl-telefono-pedido", "1");
    render(<PhoneGateBanner status="pendiente" />);

    expect(document.body.textContent).toMatch(/seguir leyendo/i);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/ajustes/telefono");
  });

  it("en la pantalla del teléfono no molesta", () => {
    mocks.pathname = "/ajustes/telefono";
    render(<PhoneGateBanner status="pendiente" />);

    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("");
  });

  it("no interrumpe en Ajustes: ahí también se borra la cuenta", () => {
    mocks.pathname = "/ajustes/privacidad";
    render(<PhoneGateBanner status="pendiente" />);

    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each(["/llamadas", "/llamadas/123"])("no corta una llamada en %s", (ruta) => {
    mocks.pathname = ruta;
    const { unmount } = render(<PhoneGateBanner status="pendiente" />);

    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/seguir leyendo/i);

    unmount();
    mocks.pathname = "/feed";
    render(<PhoneGateBanner status="pendiente" />);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it("con el servicio caído no manda a ningún lado y lo dice", () => {
    render(<PhoneGateBanner status="sin_salida" />);

    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.textContent).toMatch(/seguir leyendo/i);
  });
});
