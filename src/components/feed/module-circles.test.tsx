// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MODULES } from "@/components/shell/modules";
import { t } from "@/lib/i18n";
import { COPY } from "./copy";
import { FEED_TABS, type FeedTabId } from "./helpers";
import { ModuleCircles, feedTabHref, moduleCircles, ringSpring } from "./module-circles";

/**
 * La fila de módulos que reemplazó a los tabs de texto (pedido del cliente
 * 2026-08-12). Lo que estos tests protegen es lo que se puede romper sin que se
 * note mirando la pantalla:
 *
 *  · que un módulo apagado desde /admin/dominio NO llegue a la fila;
 *  · que cada círculo lleve adonde dice su nombre (filtro vs. sección);
 *  · que el activo se marque por FORMA y no sólo por color;
 *  · que la lista salga del registro de módulos y de la config del tenant, y
 *    nunca de una lista de nombres escrita a mano en el componente.
 */

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

/** El anillo activo anima su salto; acá se testea la fila, no la animación. */
vi.mock("motion/react", async () =>
  (await import("@/test/motion-mock")).motionMock(),
);

/**
 * jsdom no implementa scroll (no tiene layout). La fila trae a la vista el
 * círculo activo moviendo el `scrollLeft` de SU carril — comportamiento de
 * navegador real, no lógica de este componente: se apaga acá.
 *
 * `scrollIntoView` sigue stubeado aunque la fila ya no lo use: si alguien lo
 * vuelve a meter, el test tiene que fallar por lo que importa (la página se
 * mueve en vertical) y no por un método inexistente en jsdom.
 */
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollBy = vi.fn();
});


/** Comunidad recién sembrada: nadie decidió nada todavía. */
const SIN_DECISIONES: Record<string, boolean> = {};

function renderRow(
  active: FeedTabId = "para-ti",
  modules: Record<string, boolean> | null = SIN_DECISIONES,
  modulesSoon: Record<string, boolean> | null = SIN_DECISIONES,
) {
  return render(
    <ModuleCircles active={active} modules={modules} modulesSoon={modulesSoon} />,
  );
}

function hrefs() {
  return screen.getAllByRole("link").map((link) => link.getAttribute("href"));
}

describe("moduleCircles (cómo se arma la fila)", () => {
  it("sale del registro de módulos, no de una lista escrita a mano", () => {
    const { filters, sections } = moduleCircles(SIN_DECISIONES, SIN_DECISIONES);
    const registro = new Set(MODULES.map((item) => item.href));
    for (const circle of [...filters, ...sections]) {
      expect(registro.has(circle.key), `${circle.key} no existe en MODULES`).toBe(true);
    }
  });

  /**
   * ⚠️ "siguiendo" (0119) queda EXCLUIDO a propósito, y es una deuda anotada,
   * no una decisión de diseño: esta fila sale del registro de MÓDULOS
   * (secciones/verticales con su propio href), y "Siguiendo" no es una
   * sección — es un segundo lente sobre el MISMO feed que "Todo", sin ruta
   * propia en `MODULES`. Su puerta visual NO es un círculo: es el conmutador
   * "Para ti | Siguiendo" (`feed-mode-toggle.tsx`), que aparece en los dos
   * tabs sociales. Por eso este test excluye "siguiendo" del 1:1 con los
   * círculos y el del conmutador cubre la entrada.
   */
  it("los tabs del feed QUE SON VERTICALES tienen su círculo — ninguno se queda sin puerta", () => {
    const { filters } = moduleCircles(SIN_DECISIONES, SIN_DECISIONES);
    const tabsConCirculoPropio = FEED_TABS.map((tab) => tab.id).filter(
      (id) => id !== "siguiendo",
    );
    expect(filters.map((circle) => circle.tab).sort()).toEqual(
      tabsConCirculoPropio.sort(),
    );
  });

  it("los módulos sin tab van al grupo de secciones, con su ruta propia", () => {
    const { sections } = moduleCircles(SIN_DECISIONES, SIN_DECISIONES);
    expect(sections.map((circle) => circle.href)).toEqual([
      "/empleos",
      "/marketplace",
      "/creadores",
      "/comunidad",
    ]);
  });

  it("Videos no ocupa lugar: ya es una pestaña del bottom nav", () => {
    const { filters, sections } = moduleCircles(SIN_DECISIONES, SIN_DECISIONES);
    expect([...filters, ...sections].map((circle) => circle.key)).not.toContain("/videos");
  });

  it("un módulo en 'muy pronto' deja de filtrar el feed y apunta a su sección", () => {
    // Filtrar el feed por una vertical que todavía no abrió muestra una lista
    // vacía sin explicar nada; su ruta, en cambio, tiene la pantalla que avisa.
    const { filters, sections } = moduleCircles(
      { eventos: false },
      { eventos: true },
    );
    expect(filters.map((circle) => circle.tab)).not.toContain("eventos");
    const eventos = sections.find((circle) => circle.key === "/eventos");
    expect(eventos?.href).toBe("/eventos");
    expect(eventos?.state).toBe("soon");
  });
});

describe("ModuleCircles", () => {
  afterEach(cleanup);

  /**
   * REGRESIÓN (cliente 2026-08-20): "una barrita del color del tema que viene
   * desde abajo del todo" al clickear un filtro en la compu.
   *
   * No era el anillo. La fila llamaba `scrollIntoView({ block: "nearest" })`,
   * que mira también el eje VERTICAL y pegaba un salto de PÁGINA cuando la fila
   * había quedado fuera de vista (o sea, cada vez que alguien venía scrolleando
   * el feed). El anillo del módulo activo se anima con `layoutId` —midiendo la
   * posición antes y después—, así que ese salto entraba en la medición y lo
   * hacía cruzar la pantalla en diagonal.
   *
   * Lo que se fija acá es la causa, no el síntoma: al montar la fila con un
   * filtro elegido no se llama NADA que pueda mover el scroll vertical del
   * documento. El ajuste horizontal se hace sobre el `scrollLeft` del carril,
   * que no puede tocar la página.
   */
  it("traer a la vista el filtro elegido NO puede mover la página en vertical", () => {
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;

    renderRow("negocios");

    expect(intoView).not.toHaveBeenCalled();
  });

  it("cada círculo lleva adonde promete su nombre", () => {
    renderRow();
    expect(hrefs()).toEqual([
      "/feed",
      "/feed?tab=propiedades",
      "/feed?tab=eventos",
      "/feed?tab=negocios",
      "/feed?tab=profesionales",
      "/empleos",
      "/marketplace",
      "/creadores",
      "/comunidad",
    ]);
  });

  it("todos llevan nombre visible — nunca un círculo mudo", () => {
    renderRow();
    for (const link of screen.getAllByRole("link")) {
      expect(link.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
    expect(screen.getByRole("link", { name: COPY.modules.paraTi })).toBeTruthy();
  });

  it("son dos grupos con nombre: los que filtran acá y los que te llevan afuera", () => {
    renderRow();
    const listas = screen.getAllByRole("list");
    expect(listas.map((lista) => lista.getAttribute("aria-label"))).toEqual([
      COPY.modules.filtersLabel,
      COPY.modules.sectionsLabel,
    ]);
    expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe(
      COPY.modules.ariaLabel,
    );
  });

  it("marca aria-current='page' en el filtro vigente, y en uno solo", () => {
    renderRow("negocios");
    const marcados = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(marcados).toHaveLength(1);
    expect(marcados[0]?.getAttribute("href")).toBe("/feed?tab=negocios");
  });

  it("el activo se distingue por forma, no sólo por color", () => {
    renderRow("eventos");
    const activo = screen.getByRole("link", { name: "Eventos" });
    // El anillo (span extra dentro del enlace) y el peso del nombre: las dos
    // señales sobreviven a una pantalla en escala de grises.
    expect(activo.querySelector(".rounded-full.pointer-events-none")).not.toBeNull();
    expect(activo.textContent).toBe("Eventos");
    expect(activo.innerHTML).toContain("font-semibold");
  });

  it("ninguna sección se marca activa: no son el estado de esta pantalla", () => {
    renderRow("para-ti");
    const empleos = screen.getByRole("link", { name: t("nav", "moduleEmpleos") });
    expect(empleos.getAttribute("aria-current")).toBeNull();
  });

  it("un módulo apagado desde el panel no aparece", () => {
    renderRow("para-ti", { marketplace: false, creadores: false }, {});
    expect(hrefs()).not.toContain("/marketplace");
    expect(hrefs()).not.toContain("/creadores");
    expect(screen.queryByRole("link", { name: t("nav", "moduleMarketplace") })).toBeNull();
  });

  it("apagar una vertical con tab le saca el círculo, no sólo el contenido", () => {
    renderRow("para-ti", { eventos: false }, {});
    expect(hrefs()).not.toContain("/feed?tab=eventos");
  });

  it("un módulo en 'muy pronto' se ve, lo dice con texto y sigue siendo enlace", () => {
    renderRow("para-ti", { marketplace: false }, { marketplace: true });
    const marketplace = screen.getByRole("link", {
      name: new RegExp(t("nav", "moduleMarketplace")),
    });
    expect(marketplace.getAttribute("href")).toBe("/marketplace");
    // El aviso viaja en el TEXTO del enlace, así que lo lee la pantalla y lo
    // anuncia el lector: no es un color ni un tooltip.
    expect(marketplace.textContent).toContain(t("nav", "moduleSoonBadge"));
  });

  it("sin módulos que lleven afuera, no hay segundo grupo ni separador", () => {
    renderRow(
      "para-ti",
      { empleos: false, marketplace: false, creadores: false, comunidad: false },
      {},
    );
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });

  it("con la config vacía (DB caída / comunidad nueva) la fila sale entera", () => {
    // Ausente = activo: un hueco de configuración no puede parecerse a una
    // decisión de producto (ver shell/module-access.ts).
    renderRow("para-ti", null, null);
    // 9 = 5 que filtran el feed + 4 que llevan afuera (Empleos, Marketplace,
    // Influencers, Comunidad). Videos queda afuera: ya es pestaña del bottom nav.
    expect(screen.getAllByRole("link")).toHaveLength(9);
  });
});

describe("feedTabHref", () => {
  it("el feed sin filtrar no arrastra query", () => {
    expect(feedTabHref("para-ti")).toBe("/feed");
  });

  it("los demás filtros viven en la URL, como antes", () => {
    expect(feedTabHref("propiedades")).toBe("/feed?tab=propiedades");
  });
});

/**
 * El pedido del cliente (2026-07-20) sobre el indicador activo fue explícito y
 * medible: que "se pase un poquitín y vuelva", y que cuanto más lejos salte, un
 * poquitín más — sutil. Era del subrayado de los tabs; el anillo de los
 * círculos heredó el mismo resorte y las mismas propiedades.
 */
describe("ringSpring", () => {
  it("siempre rebota algo (nunca frena en seco)", () => {
    for (const d of [1, 2, 3, 4]) {
      expect(ringSpring(d).bounce).toBeGreaterThan(0);
    }
  });

  it("cuanto más lejos el salto, más rebote y más tiempo", () => {
    const saltos = [1, 2, 3, 4].map(ringSpring);
    for (let i = 1; i < saltos.length; i++) {
      expect(saltos[i].bounce).toBeGreaterThan(saltos[i - 1].bounce);
      expect(saltos[i].visualDuration).toBeGreaterThan(saltos[i - 1].visualDuration);
    }
  });

  it("el rebote se mantiene SUTIL en todo el rango", () => {
    // >0.3 ya se lee como "rebotó"; la referencia de UI premium vive por debajo.
    for (const d of [1, 2, 3, 4]) {
      expect(ringSpring(d).bounce).toBeLessThanOrEqual(0.25);
    }
  });

  it("la animación se mantiene dentro del presupuesto de micro-interacción", () => {
    // ≤400ms: arriba de eso deja de sentirse como respuesta al toque.
    for (const d of [1, 2, 3, 4]) {
      expect(ringSpring(d).visualDuration).toBeLessThanOrEqual(0.4);
    }
  });

  it("clampea distancias fuera de rango en vez de extrapolar", () => {
    expect(ringSpring(0)).toEqual(ringSpring(1));
    expect(ringSpring(-3)).toEqual(ringSpring(1));
    expect(ringSpring(99)).toEqual(ringSpring(4));
  });
});
