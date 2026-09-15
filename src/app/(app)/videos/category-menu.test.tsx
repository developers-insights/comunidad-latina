// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VIDEO_CATEGORIES } from "@/lib/media/video-policy";
import { t } from "@/lib/i18n";
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

// `ModuleSearchBar` (buscador del menú, 2026-09-15) es cliente y usa estos
// hooks — sin el mock, renderizar el menú en jsdom explota fuera de un router.
const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/videos",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => nav.replace.mockReset());
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

    // Once salidas exactas: "Todos", las nueve categorías, y —desde el
    // 2026-09-03— Videos largos. Nada de más, nada de menos.
    expect(screen.getAllByRole("link")).toHaveLength(VIDEO_CATEGORIES.length + 2);
  });

  /**
   * VIDEOS LARGOS (cliente 2026-09-03, pedido dos veces en la misma call): la
   * sección donde un video de 5 minutos se ve entero. Entra por acá, y no como
   * una categoría más: los nueve temas de arriba son puertas al MISMO contenido
   * —los cortos de la comunidad— y esto es otra clase de video.
   */
  it("ofrece la salida a Videos largos, aparte de los temas", () => {
    render(<VideoCategoryMenu />);

    const largos = screen.getByRole("link", { name: "Ver los videos largos" });
    expect(largos.getAttribute("href")).toBe("/videos/largos");
    // No se disfraza de tema: ninguna categoría linkea ahí.
    for (const category of VIDEO_CATEGORIES) {
      const label = VIDEO_CATEGORY_LABELS[category];
      const link = screen.getByRole("link", { name: `Ver videos de ${label}` });
      expect(link.getAttribute("href")).not.toContain("/largos");
    }
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

  /**
   * Buscador (pedido cliente 2026-09-15: "un lugar donde se puedan buscar los
   * videos... como TikTok o Instagram"). Sólo se ancla que esté presente y
   * accesible; el comportamiento de escribir/enviar es de `ModuleSearchBar`,
   * ya probado donde vive.
   */
  it("ofrece un buscador de videos, visible desde que se entra a la sección", () => {
    render(<VideoCategoryMenu />);
    expect(
      screen.getByRole("searchbox", { name: t("sections", "searchVideosLabel") }),
    ).toBeTruthy();
  });
});
