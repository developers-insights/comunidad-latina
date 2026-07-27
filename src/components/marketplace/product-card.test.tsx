// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProductCard, type ProductCardModel } from "./product-card";

/**
 * Mismo reparto de gestos que Vivienda (feedback cliente 2026-07-26): tocar la
 * FOTO del producto abre el visor con toda la galería y NUNCA navega; al detalle
 * se entra por la píldora "Ver producto". Esta card es la representativa de las
 * que usan <CardMedia> con foto de respaldo genérica: sin foto propia el
 * respaldo (og-default) no es contenido, así que no abre visor.
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

const BASE: ProductCardModel = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  title: "Bicicleta de paseo, poco uso",
  priceLabel: "US$ 120",
  category: "otros",
  photoUrl: "https://cdn.example.com/bici-1.webp",
  photos: ["https://cdn.example.com/bici-1.webp", "https://cdn.example.com/bici-2.webp"],
  // Particular a propósito: el chip de tienda linkea a su vidriera y ensuciaría
  // el conteo de links de la card.
  seller: { kind: "private", name: "Rosa Medina" },
};

function photoButton() {
  return screen.getByRole("button", { name: /ver fotos de/i });
}

beforeEach(() => viewer.open.mockReset());
afterEach(cleanup);

describe("ProductCard: la foto abre el visor", () => {
  it("tocar la foto abre el visor con TODAS las fotos del producto", () => {
    render(<ProductCard product={BASE} />);
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledTimes(1);
    expect(viewer.open).toHaveBeenCalledWith({
      items: [
        { kind: "image", url: "https://cdn.example.com/bici-1.webp" },
        { kind: "image", url: "https://cdn.example.com/bici-2.webp" },
      ],
      authorName: BASE.title,
    });
  });

  it("sin `photos` (contrato viejo) cae a la única foto que conoce", () => {
    render(<ProductCard product={{ ...BASE, photos: undefined }} />);
    fireEvent.click(photoButton());

    expect(viewer.open).toHaveBeenCalledWith({
      items: [{ kind: "image", url: "https://cdn.example.com/bici-1.webp" }],
      authorName: BASE.title,
    });
  });

  it("sin foto propia el respaldo genérico no es tocable", () => {
    render(<ProductCard product={{ ...BASE, photoUrl: null, photos: [] }} />);

    expect(screen.queryByRole("button", { name: /ver fotos de/i })).toBeNull();
    expect(screen.getByRole("heading", { name: BASE.title })).toBeTruthy();
  });
});

describe("ProductCard: al detalle se entra SOLO por la píldora", () => {
  it("la foto ya no navega — el único link de la card es 'Ver producto'", () => {
    render(<ProductCard product={BASE} />);
    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(`/marketplace/${BASE.id}`);
  });

  it("tocar la píldora NO abre el visor", () => {
    render(<ProductCard product={BASE} />);
    fireEvent.click(screen.getByRole("link", { name: BASE.title }));

    expect(viewer.open).not.toHaveBeenCalled();
  });
});
