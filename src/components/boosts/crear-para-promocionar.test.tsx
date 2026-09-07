// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CrearParaPromocionarCta } from "./crear-para-promocionar-cta";
import { SelectorDeCreacion } from "./selector-de-creacion";
import { opcionesDisponibles } from "./opciones-para-promocionar";

/**
 * LO QUE FALTABA EN BOOST (reporte del cliente con captura, 2026-09-07: "en la
 * sección de boost falta el botón de poder crear una publicidad").
 *
 * Estos tests anclan las dos mitades del arreglo, que son las dos que se
 * pierden en silencio si alguien reordena la pantalla:
 *  · el CTA de crear existe SIEMPRE y apunta a /impulsar/crear — el bug
 *    original era justamente que existía sólo dentro del `EmptyState`;
 *  · el selector manda a los creadores que YA existen y respeta los módulos
 *    apagados del tenant, en vez de ofrecer una pantalla que no está abierta.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const TODO_PRENDIDO: Record<string, boolean> = {
  propiedades: true,
  negocios: true,
  profesionales: true,
  eventos: true,
  empleos: true,
  marketplace: true,
  creadores: true,
};

describe("CrearParaPromocionarCta", () => {
  it("es un link al selector, no un botón muerto", () => {
    render(<CrearParaPromocionarCta />);
    // Sin matchers de jest-dom: no están registrados globalmente en este repo.
    const enlace = screen.getByRole("link", { name: /Publicá algo nuevo/i });
    expect(enlace.getAttribute("href")).toBe("/impulsar/crear");
  });

  it("explica el orden real: primero se publica, después se promociona", () => {
    render(<CrearParaPromocionarCta />);
    expect(screen.getByText(/volvé acá para ponerle Boost/i)).toBeTruthy();
  });
});

describe("SelectorDeCreacion", () => {
  it("ofrece un link por opción, cada uno al creador que ya existe", () => {
    const opciones = opcionesDisponibles(TODO_PRENDIDO, {});
    render(<SelectorDeCreacion opciones={opciones} />);

    const hrefs = screen
      .getAllByRole("link")
      .map((enlace) => enlace.getAttribute("href"));

    expect(hrefs).toEqual([
      "/publicar?kind=property",
      "/publicar?kind=business",
      "/publicar?kind=professional",
      "/publicar?kind=event",
      "/empleos/publicar",
      "/marketplace/publicar",
      "/creadores/publicar",
      "/feed",
    ]);
  });

  it("separa avisos de publicaciones, igual que el índice de Boost", () => {
    render(<SelectorDeCreacion opciones={opcionesDisponibles(TODO_PRENDIDO, {})} />);
    expect(screen.getByRole("heading", { name: "Avisos" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Publicaciones" })).toBeTruthy();
  });

  it("un módulo apagado no aparece ni como fila muerta", () => {
    const opciones = opcionesDisponibles({ ...TODO_PRENDIDO, marketplace: false }, {});
    render(<SelectorDeCreacion opciones={opciones} />);

    const hrefs = screen
      .getAllByRole("link")
      .map((enlace) => enlace.getAttribute("href"));
    expect(hrefs).not.toContain("/marketplace/publicar");
    expect(hrefs).toContain("/publicar?kind=business");
  });

  it("sin avisos disponibles no dibuja el grupo vacío", () => {
    const todoApagado = Object.fromEntries(
      Object.keys(TODO_PRENDIDO).map((clave) => [clave, false]),
    );
    render(<SelectorDeCreacion opciones={opcionesDisponibles(todoApagado, {})} />);

    expect(screen.queryByRole("heading", { name: "Avisos" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Publicaciones" })).toBeTruthy();
  });
});
