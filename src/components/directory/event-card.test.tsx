// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EventCard, type EventCardModel } from "./event-card";

/**
 * Feedback cliente 2026-07-26: en Vivienda "quedó perfecto" — tocás la foto y
 * se abre la foto — y en el resto de las secciones tocar la foto "te sacaba de
 * la pantalla". Acá se fija la regla ya extendida a Eventos, que es la card
 * representativa de las que se apoyan en <DirectoryMedia> (fallback de ícono
 * cuando el aviso no trae foto).
 */

const viewer = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("@/components/feed/media-viewer", () => ({
  useMediaViewer: () => ({ open: viewer.open }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

const BASE: EventCardModel = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  title: "Feria dominicana en Corona Plaza",
  venueArea: "Corona, Queens",
  date: null,
  free: true,
  photoUrl: "https://cdn.example.com/feria-1.webp",
  photos: ["https://cdn.example.com/feria-1.webp", "https://cdn.example.com/feria-2.webp"],
  publisherTrust: null,
  publisherName: "Casa Dominicana",
};

function photoButton() {
  return screen.getByRole("button", { name: /ver fotos de/i });
}

beforeEach(() => viewer.open.mockReset());
afterEach(cleanup);

describe("EventCard: la foto abre el visor", () => {
  it("tocar la foto abre el visor con TODAS las fotos del evento", () => {
    render(<EventCard event={BASE} />);
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledTimes(1);
    expect(viewer.open).toHaveBeenCalledWith({
      items: [
        { kind: "image", url: "https://cdn.example.com/feria-1.webp" },
        { kind: "image", url: "https://cdn.example.com/feria-2.webp" },
      ],
      authorName: BASE.title,
    });
  });

  it("sin `photos` (contrato viejo) cae a la única foto que conoce", () => {
    render(<EventCard event={{ ...BASE, photos: undefined }} />);
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledWith({
      items: [{ kind: "image", url: "https://cdn.example.com/feria-1.webp" }],
      authorName: BASE.title,
    });
  });

  it("sin foto real no hay área tocable: el fallback del módulo no es una foto", () => {
    render(<EventCard event={{ ...BASE, photoUrl: null, photos: [] }} />);

    expect(screen.queryByRole("button", { name: /ver fotos de/i })).toBeNull();
    // La card sigue completa: el título y el CTA no dependen de la foto.
    expect(screen.getByRole("heading", { name: BASE.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: BASE.title })).toBeTruthy();
  });
});

describe("EventCard: al detalle se entra SOLO por la píldora", () => {
  it("la foto ya no navega — el único link de la card es 'Ver evento'", () => {
    render(<EventCard event={BASE} />);
    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(`/eventos/${BASE.id}`);
  });

  it("tocar la píldora NO abre el visor", () => {
    render(<EventCard event={BASE} />);
    fireEvent.click(screen.getByRole("link", { name: BASE.title }));

    expect(viewer.open).not.toHaveBeenCalled();
  });
});
