// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmploymentTypeChips } from "./employment-type-chips";
import { COPY } from "./copy";

/**
 * Chips de jornada de /empleos (L1 — changas). El estado vive en la URL
 * (`?tipo=`), no en useState, así que lo que hay que cuidar es que:
 *  - las TRES categorías salgan solas de EMPLOYMENT_TYPES (nadie las lista a
 *    mano acá, así que "Ocasional" aparece sin tocar este archivo);
 *  - tocar un chip escriba el `?tipo=` correcto y borre el cursor de paginado;
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

describe("EmploymentTypeChips", () => {
  it("ofrece Todos + las tres categorías, en el orden del catálogo", () => {
    render(<EmploymentTypeChips />);
    const chips = screen.getAllByRole("button").map((button) => button.textContent);
    expect(chips).toEqual([COPY.list.filterAll, "Tiempo completo", "Medio tiempo", "Ocasional"]);
  });

  it("tocar 'Ocasional' escribe ?tipo=one_off y borra el cursor", () => {
    render(<EmploymentTypeChips />);
    fireEvent.click(screen.getByRole("button", { name: "Ocasional" }));

    expect(nav.replace).toHaveBeenCalledTimes(1);
    const [url] = nav.replace.mock.calls[0];
    expect(url).toBe("/empleos?tipo=one_off");
  });

  it("con ?tipo=one_off activo, el chip 'Ocasional' es el marcado", () => {
    params.value = "tipo=one_off";
    render(<EmploymentTypeChips />);

    expect(screen.getByRole("button", { name: "Ocasional" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Tiempo completo" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("volver a 'Todos' limpia ?tipo= en vez de mandarlo vacío", () => {
    params.value = "tipo=one_off&cursor=abc";
    render(<EmploymentTypeChips />);
    fireEvent.click(screen.getByRole("button", { name: COPY.list.filterAll }));

    const [url] = nav.replace.mock.calls[0];
    expect(url).toBe("/empleos");
  });
});
