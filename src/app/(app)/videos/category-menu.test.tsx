// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VIDEO_CATEGORIES } from "@/lib/media/video-policy";
import { VideoCategoryMenu } from "./category-menu";
import { VIDEO_CATEGORY_LABELS } from "./copy";

/**
 * El menú de entrada existe por un pedido textual del cliente (call del 29/7,
 * 1:20): antes `/videos` arrancaba reproduciendo de una. Lo que este archivo
 * ancla es que estén LAS DIEZ salidas —"Todos" más las nueve categorías del
 * catálogo cerrado— y que cada una lleve a su reel filtrado: si una categoría
 * se agrega en la base y nadie la trae acá, el menú deja de ser el catálogo.
 */

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("Menú de entrada de Videos Cortos", () => {
  it("ofrece 'Todos' y las nueve categorías, cada una a su reel filtrado", () => {
    render(<VideoCategoryMenu />);

    const todos = screen.getByRole("link", { name: "Ver todos los videos" });
    expect(todos.getAttribute("href")).toBe("/videos?cat=todos");

    for (const category of VIDEO_CATEGORIES) {
      const label = VIDEO_CATEGORY_LABELS[category];
      const link = screen.getByRole("link", { name: `Ver videos de ${label}` });
      expect(link.getAttribute("href")).toBe(`/videos?cat=${category}`);
    }

    // Diez salidas exactas: nada de más, nada de menos.
    expect(screen.getAllByRole("link")).toHaveLength(VIDEO_CATEGORIES.length + 1);
  });

  it("cada categoría se lee, no sólo se reconoce por su ícono", () => {
    render(<VideoCategoryMenu />);
    for (const category of VIDEO_CATEGORIES) {
      expect(screen.getByText(VIDEO_CATEGORY_LABELS[category])).toBeTruthy();
    }
  });

  it("la pantalla se presenta con un solo encabezado de nivel 1", () => {
    render(<VideoCategoryMenu />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
