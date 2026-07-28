// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BottomNav } from "./bottom-nav";

/**
 * Feedback del cliente (27/7): "Propiedades" deja de ocupar una pestaña fija y
 * entra "Buscar", que abre la grilla de categorías. Videos sigue al centro
 * (decisión previa del sprint de reels — patrón Instagram/TikTok).
 *
 * Lo que este test protege:
 *  - que Vivienda no vuelva a robarle el lugar a Buscar;
 *  - que Videos no se corra del centro;
 *  - la diferencia entre estado VISUAL (rama) y `aria-current="page"` (la
 *    página exacta), que es donde es fácil meter un bug de accesibilidad.
 */

const state = vi.hoisted(() => ({ pathname: "/feed" }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
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

/** Todos los módulos prendidos: el estado normal de la app. */
const TODO_PRENDIDO = { feed: true, videos: true, mensajes: true };

function renderAt(
  pathname: string,
  modules: Record<string, boolean> = TODO_PRENDIDO,
  modulesSoon: Record<string, boolean> = {},
) {
  state.pathname = pathname;
  return render(<BottomNav modules={modules} modulesSoon={modulesSoon} />);
}

function hrefs() {
  return screen.getAllByRole("link").map((link) => link.getAttribute("href"));
}

describe("BottomNav", () => {
  afterEach(cleanup);

  it("ofrece Buscar en lugar de Propiedades, con Videos al centro", () => {
    renderAt("/feed");
    expect(hrefs()).toEqual(["/feed", "/buscar", "/videos", "/mensajes", "/perfil"]);
    // El ítem del medio de cinco es el tercero: Videos, a un pulgar.
    expect(hrefs()[2]).toBe("/videos");
  });

  it("las cinco pestañas llevan texto visible, nunca solo ícono", () => {
    renderAt("/feed");
    for (const link of screen.getAllByRole("link")) {
      expect(link.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
    expect(screen.getByRole("link", { name: "Buscar" })).toBeTruthy();
  });

  it("marca aria-current='page' sólo en la pestaña de la página actual", () => {
    renderAt("/buscar");
    const marcadas = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0]?.getAttribute("href")).toBe("/buscar");
  });

  it("resalta Buscar dentro de una categoría, pero sin mentir con aria-current", () => {
    // Antes, estando en /negocios ninguna pestaña estaba marcada: el bottom nav
    // no decía dónde estabas. Ahora Buscar queda encendida (señal visual), y
    // aria-current sigue libre porque /negocios NO es la página /buscar.
    renderAt("/negocios");
    const buscar = screen.getByRole("link", { name: "Buscar" });
    expect(buscar.className).toContain("text-brand-ink");
    expect(buscar.getAttribute("aria-current")).toBeNull();
    expect(
      screen.getAllByRole("link").some((link) => link.getAttribute("aria-current") === "page"),
    ).toBe(false);
  });

  it("una subruta de la categoría sigue resaltando Buscar", () => {
    renderAt("/propiedades/abc-123");
    expect(screen.getByRole("link", { name: "Buscar" }).className).toContain("text-brand-ink");
  });

  it("Videos NO enciende Buscar: es su propia pestaña", () => {
    renderAt("/videos");
    expect(screen.getByRole("link", { name: "Buscar" }).className).not.toContain("text-brand-ink");
    expect(screen.getByRole("link", { name: "Videos" }).getAttribute("aria-current")).toBe("page");
  });
});

/**
 * Módulos apagados desde /admin/dominio. La regla: una pestaña de la navegación
 * primaria sólo existe si su módulo está ACTIVO — ni oculto ni "muy pronto". Un
 * lugar de cinco no puede llevar a un cartel de "todavía no abrimos".
 */
describe("BottomNav — módulos apagados desde el panel", () => {
  afterEach(cleanup);

  it("Videos apagado saca su pestaña, y las otras cuatro se corren sin dejar hueco", () => {
    renderAt("/feed", { feed: true, videos: false, mensajes: true }, { videos: false });
    expect(hrefs()).toEqual(["/feed", "/buscar", "/mensajes", "/perfil"]);
    expect(screen.queryByRole("link", { name: "Videos" })).toBeNull();
  });

  it("Videos en 'muy pronto' TAMPOCO ocupa pestaña: la barra no anuncia, navega", () => {
    // El anuncio vive en el menú y en /buscar, con su etiqueta "Muy pronto".
    renderAt("/feed", { feed: true, videos: false, mensajes: true }, { videos: true });
    expect(hrefs()).toEqual(["/feed", "/buscar", "/mensajes", "/perfil"]);
  });

  it("Inicio y Mensajes NO se apagan: son la infraestructura del shell", () => {
    // ALWAYS_ON_MODULE_KEYS. Sin Inicio la app queda sin casa (el logo del
    // header apunta ahí) y sin Mensajes se rompen los CTA de contacto de toda
    // la plataforma, que ni pasan por esta barra.
    renderAt("/feed", { feed: false, videos: false, mensajes: false }, {});
    expect(hrefs()).toEqual(["/feed", "/buscar", "/mensajes", "/perfil"]);
  });

  it("con la config vacía (DB caída / comunidad recién sembrada) la barra sale ENTERA", () => {
    // Sin una sola decisión guardada no hay nada que respetar: las cinco
    // pestañas están. Videos incluido — que se le caiga la pestaña a una
    // comunidad porque nadie tocó todavía el panel sería un apagado que nadie
    // pidió (ver el default en shell/module-access.ts).
    renderAt("/feed", {}, {});
    expect(hrefs()).toEqual(["/feed", "/buscar", "/videos", "/mensajes", "/perfil"]);
    for (const link of screen.getAllByRole("link")) {
      expect(link.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});
