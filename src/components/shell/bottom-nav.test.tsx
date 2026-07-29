// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BottomNav } from "./bottom-nav";

/**
 * Barra 2026-07-29 (pedido de Manuel): Inicio · Buscar · [+] · Videos · Ajustes.
 * Mensajes y Perfil se mudaron al header; el centro dejó de ser un destino y
 * pasó a ser la acción de publicar.
 *
 * Lo que este test protege:
 *  - el orden y que el "+" quede en el MEDIO (es el centro óptico de la barra);
 *  - que el "+" no sea un enlace ni marque página: es un disparador de menú;
 *  - que sin sesión lleve a entrar en vez de abrir un menú de opciones muertas;
 *  - que apagar Videos NO corra el "+" de lugar (casillero vacío a propósito);
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

/** El "+" anima su rotación; acá se testea la barra, no la animación. */
vi.mock("motion/react", () => {
  const passthrough = ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) => {
    const domProps = Object.fromEntries(
      Object.entries(props).filter(
        ([key]) => !["initial", "animate", "exit", "transition", "whileTap"].includes(key),
      ),
    );
    return <span {...domProps}>{children}</span>;
  };
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    m: { span: passthrough, div: passthrough },
    useReducedMotion: () => true,
  };
});

/** Todos los módulos prendidos: el estado normal de la app. */
const TODO_PRENDIDO = { feed: true, videos: true, mensajes: true };

function renderAt(
  pathname: string,
  {
    modules = TODO_PRENDIDO,
    modulesSoon = {},
    canCreate = true,
    unread = 0,
  }: {
    modules?: Record<string, boolean>;
    modulesSoon?: Record<string, boolean>;
    canCreate?: boolean;
    unread?: number;
  } = {},
) {
  state.pathname = pathname;
  return render(
    <BottomNav
      modules={modules}
      modulesSoon={modulesSoon}
      canCreate={canCreate}
      unread={unread}
    />,
  );
}

function hrefs() {
  return screen.getAllByRole("link").map((link) => link.getAttribute("href"));
}

/** Los <li> de la barra, incluido el casillero del "+" y los vacíos. */
function slots() {
  return [...screen.getByRole("navigation").querySelectorAll("li")];
}

describe("BottomNav", () => {
  afterEach(cleanup);

  it("son cuatro pestañas y el '+' al medio", () => {
    renderAt("/feed");
    expect(hrefs()).toEqual(["/feed", "/buscar", "/videos", "/ajustes"]);
    // Cinco casilleros; el tercero —el del medio— es el del disparador.
    const casilleros = slots();
    expect(casilleros).toHaveLength(5);
    expect(casilleros[2]?.querySelector("button")).not.toBeNull();
  });

  it("el '+' es un disparador de menú, no un destino", () => {
    renderAt("/feed");
    const crear = screen.getByRole("button", { name: "Crear" });
    expect(crear.getAttribute("aria-haspopup")).toBe("dialog");
    expect(crear.getAttribute("aria-expanded")).toBe("false");
    // Nunca marca página: no es una pestaña.
    expect(crear.getAttribute("aria-current")).toBeNull();
  });

  it("sin sesión el '+' lleva a entrar en vez de abrir opciones muertas", () => {
    renderAt("/feed", { canCreate: false });
    expect(screen.queryByRole("button", { name: "Crear" })).toBeNull();
    const crear = screen.getByRole("link", { name: "Crear" });
    expect(crear.getAttribute("href")).toBe("/entrar?next=/feed");
  });

  it("las cuatro pestañas llevan texto visible, nunca solo ícono", () => {
    renderAt("/feed");
    for (const link of screen.getAllByRole("link")) {
      expect(link.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
    expect(screen.getByRole("link", { name: "Buscar" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ajustes" })).toBeTruthy();
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

  it("las notificaciones sin leer avisan en Ajustes, que es donde viven", () => {
    renderAt("/feed", { unread: 3 });
    const ajustes = screen.getByRole("link", { name: /Ajustes/ });
    // Texto, no sólo un punto de color: el aviso tiene que llegar también a
    // quien escucha la pantalla.
    expect(ajustes.textContent).toContain("sin leer");
  });

  it("sin novedades no hay aviso", () => {
    renderAt("/feed", { unread: 0 });
    expect(screen.getByRole("link", { name: "Ajustes" }).textContent).not.toContain("sin leer");
  });
});

/**
 * Módulos apagados desde /admin/dominio. La regla: una pestaña de la navegación
 * primaria sólo existe si su módulo está ACTIVO — ni oculto ni "muy pronto". Un
 * lugar de la barra no puede llevar a un cartel de "todavía no abrimos".
 */
describe("BottomNav — módulos apagados desde el panel", () => {
  afterEach(cleanup);

  it("Videos apagado saca su pestaña SIN correr el '+' del centro", () => {
    renderAt("/feed", { modules: { feed: true, videos: false, mensajes: true }, modulesSoon: { videos: false } });
    expect(hrefs()).toEqual(["/feed", "/buscar", "/ajustes"]);
    expect(screen.queryByRole("link", { name: "Videos" })).toBeNull();
    // El casillero queda vacío a propósito: la grilla es de cinco columnas y el
    // disparador tiene que seguir cayendo bajo el pulgar, en el medio.
    const casilleros = slots();
    expect(casilleros).toHaveLength(5);
    expect(casilleros[2]?.querySelector("button")).not.toBeNull();
    expect(casilleros[3]?.textContent).toBe("");
  });

  it("Videos en 'muy pronto' TAMPOCO ocupa pestaña: la barra no anuncia, navega", () => {
    // El anuncio vive en /buscar, con su etiqueta "Muy pronto".
    renderAt("/feed", { modules: { feed: true, videos: false, mensajes: true }, modulesSoon: { videos: true } });
    expect(hrefs()).toEqual(["/feed", "/buscar", "/ajustes"]);
  });

  it("Inicio no se apaga: es la infraestructura del shell", () => {
    // ALWAYS_ON_MODULE_KEYS. Sin Inicio la app queda sin casa (el logo del
    // header apunta ahí). Buscar y Ajustes no tienen clave: son estructurales.
    renderAt("/feed", { modules: { feed: false, videos: false, mensajes: false } });
    expect(hrefs()).toEqual(["/feed", "/buscar", "/ajustes"]);
  });

  it("con la config vacía (DB caída / comunidad recién sembrada) la barra sale ENTERA", () => {
    // Sin una sola decisión guardada no hay nada que respetar: las cuatro
    // pestañas están. Videos incluido — que se le caiga la pestaña a una
    // comunidad porque nadie tocó todavía el panel sería un apagado que nadie
    // pidió (ver el default en shell/module-access.ts).
    renderAt("/feed", { modules: {}, modulesSoon: {} });
    expect(hrefs()).toEqual(["/feed", "/buscar", "/videos", "/ajustes"]);
    for (const link of screen.getAllByRole("link")) {
      expect(link.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});
