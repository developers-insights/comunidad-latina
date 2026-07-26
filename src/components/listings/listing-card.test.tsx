// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ListingCard, type ListingCardModel } from "./listing-card";

/**
 * Card de vivienda, feedback 2026-07-26: DOS destinos, uno por gesto.
 * Tocar la foto abre el visor con TODAS las fotos del aviso; la píldora
 * "Ver detalles" es la única que navega. Acá se fija ese reparto con el hook
 * del visor mockeado (el provider real vive en el layout de la app).
 */

const viewer = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("@/components/feed/media-viewer", () => ({
  useMediaViewer: () => ({ open: viewer.open }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: unknown;
    children: React.ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

const BASE: ListingCardModel = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Habitación luminosa en Corona",
  priceLabel: "US$ 1.350/mes",
  areaLabel: "Corona, Queens",
  photoUrl: "https://cdn.example.com/uno.webp",
  photos: [
    "https://cdn.example.com/uno.webp",
    "https://cdn.example.com/dos.webp",
    "https://cdn.example.com/tres.webp",
  ],
  verification: null,
  publisher: null,
};

function photoButton() {
  return screen.getByRole("button", { name: /ver fotos de/i });
}

beforeEach(() => viewer.open.mockReset());
afterEach(() => cleanup());

describe("ListingCard: la foto abre el visor", () => {
  it("tocar la foto abre el visor con TODAS las fotos del aviso", () => {
    render(<ListingCard listing={BASE} />);
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledTimes(1);
    expect(viewer.open).toHaveBeenCalledWith({
      items: [
        { kind: "image", url: "https://cdn.example.com/uno.webp" },
        { kind: "image", url: "https://cdn.example.com/dos.webp" },
        { kind: "image", url: "https://cdn.example.com/tres.webp" },
      ],
      authorName: BASE.title,
    });
  });

  it("sin `photos` (contrato viejo) cae a la única foto que conoce", () => {
    render(<ListingCard listing={{ ...BASE, photos: undefined }} />);
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledWith({
      items: [{ kind: "image", url: "https://cdn.example.com/uno.webp" }],
      authorName: BASE.title,
    });
  });

  it("sin foto real el toque no abre un visor del respaldo genérico", () => {
    render(<ListingCard listing={{ ...BASE, photoUrl: null, photos: [] }} />);
    fireEvent.click(photoButton());

    expect(viewer.open).not.toHaveBeenCalled();
  });
});

describe("ListingCard: la píldora es la que navega", () => {
  it('"Ver detalles" apunta al aviso y NO abre el visor', () => {
    render(<ListingCard listing={BASE} />);
    const pill = screen.getByRole("link", { name: BASE.title });

    expect(pill.getAttribute("href")).toBe(`/propiedades/${BASE.id}`);
    fireEvent.click(pill);
    expect(viewer.open).not.toHaveBeenCalled();
  });
});
