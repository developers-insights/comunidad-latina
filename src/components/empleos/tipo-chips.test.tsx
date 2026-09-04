// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmpleosTipoChips } from "./tipo-chips";
import { COPY } from "./copy";

/**
 * Pestañas de /empleos (feedback cliente 2026-09-03, punto 12). El estado vive
 * en la URL (`?tipo=`), no en useState, así que lo que hay que cuidar es que:
 *  - las TRES pestañas salgan solas de EMPLEOS_TABS (nadie las lista a mano
 *    acá, así que una cuarta aparecería sin tocar este archivo);
 *  - tocar una escriba el `?tipo=` correcto y borre el cursor de paginado;
 *  - "Todos" siga limpiando el filtro en vez de mandar un `?tipo=` vacío.
 */

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
const params = vi.hoisted(() => ({ value: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/empleos",
  useSearchParams: () => new URLSearchParams(params.value),
}));

beforeEach(() => {
  nav.replace.mockReset();
  params.value = "";
});
afterEach(cleanup);

describe("EmpleosTipoChips", () => {
  it("ofrece Todos + las tres pestañas, en el orden del catálogo", () => {
    render(<EmpleosTipoChips />);
    const chips = screen.getAllByRole("button").map((button) => button.textContent);
    expect(chips).toEqual([COPY.list.filterAll, "Empleos", "Ocasional", "Servicios"]);
  });

  it("tocar 'Servicios' escribe ?tipo=servicios y borra el cursor", () => {
    params.value = "cursor=abc";
    render(<EmpleosTipoChips />);
    fireEvent.click(screen.getByRole("button", { name: "Servicios" }));

    expect(nav.replace).toHaveBeenCalledTimes(1);
    const [url] = nav.replace.mock.calls[0];
    expect(url).toBe("/empleos?tipo=servicios");
  });

  it("tocar 'Ocasional' escribe ?tipo=ocasional", () => {
    render(<EmpleosTipoChips />);
    fireEvent.click(screen.getByRole("button", { name: "Ocasional" }));

    const [url] = nav.replace.mock.calls[0];
    expect(url).toBe("/empleos?tipo=ocasional");
  });

  it("con ?tipo=servicios activo, esa pestaña es la marcada", () => {
    params.value = "tipo=servicios";
    render(<EmpleosTipoChips />);

    expect(screen.getByRole("button", { name: "Servicios" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Empleos" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("volver a 'Todos' limpia ?tipo= en vez de mandarlo vacío", () => {
    params.value = "tipo=servicios&cursor=abc";
    render(<EmpleosTipoChips />);
    fireEvent.click(screen.getByRole("button", { name: COPY.list.filterAll }));

    const [url] = nav.replace.mock.calls[0];
    expect(url).toBe("/empleos");
  });

  it("un link VIEJO (?tipo=part_time) marca la pestaña Empleos, igual que filtra el servidor", () => {
    params.value = "tipo=part_time";
    render(<EmpleosTipoChips />);
    expect(screen.getByRole("button", { name: "Empleos" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: COPY.list.filterAll }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("un ?tipo= inventado cae en 'Todos' en vez de dejar la barra apagada", () => {
    params.value = "tipo=freelance";
    render(<EmpleosTipoChips />);
    expect(screen.getByRole("button", { name: COPY.list.filterAll }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
