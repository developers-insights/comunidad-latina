// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MODULES } from "@/components/shell/modules";
import { t } from "@/lib/i18n";
import { COPY } from "./copy";
import { FEED_TABS, parseTab, type FeedTabId } from "./helpers";
import { ModuleCircles, feedTabHref, moduleCircles, ringSpring } from "./module-circles";

/**
 * La fila de módulos que reemplazó a los tabs de texto (pedido del cliente
 * 2026-08-12). Lo que estos tests protegen es lo que se puede romper sin que se
 * note mirando la pantalla:
 *
 *  · que un módulo apagado desde /admin/dominio NO llegue a la fila;
 *  · que cada círculo lleve a la MISMA ruta que su burbuja en /buscar — el
 *    pedido del cliente del 2026-08-26 («que tengan las mismas funciones que en
 *    el buscador») dicho de forma verificable— y que ninguno vuelva a filtrar el
 *    feed con `?tab=`;
 *  · que los `?tab=` sigan siendo rutas VÁLIDAS aunque ya no tengan puerta:
 *    sacarles el círculo no puede romper un link que alguien compartió;
 *  · que el marcado se distinga por FORMA y no sólo por color;
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

/** El anillo anima su entrada; acá se testea la fila, no la animación. */
vi.mock("motion/react", async () =>
  (await import("@/test/motion-mock")).motionMock(),
);

/**
 * jsdom no implementa scroll (no tiene layout). La fila trae a la vista el
 * círculo marcado moviendo el `scrollLeft` de SU carril — comportamiento de
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

/** El anillo del círculo marcado — la señal que sobrevive a escala de grises. */
function anillo(link: HTMLElement) {
  return link.querySelector(".rounded-full.pointer-events-none");
}

describe("moduleCircles (cómo se arma la fila)", () => {
  it("sale del registro de módulos, no de una lista escrita a mano", () => {
    const registro = new Set(MODULES.map((item) => item.href));
    for (const circle of moduleCircles(SIN_DECISIONES, SIN_DECISIONES)) {
      expect(registro.has(circle.key), `${circle.key} no existe en MODULES`).toBe(true);
    }
  });

  /**
   * EL PEDIDO DEL CLIENTE, EN UNA ASERCIÓN (2026-08-26): «que tengan las mismas
   * funciones que en el buscador».
   *
   * "Las mismas funciones" se traduce a algo verificable: el destino de cada
   * círculo tiene que ser EL MISMO `href` que /buscar le da a su burbuja para
   * ese módulo, no una ruta parecida escrita al lado. Si mañana un módulo cambia
   * de ruta, las dos superficies cambian juntas o esto se pone rojo.
   */
  it("cada círculo lleva a la MISMA ruta que su burbuja en /buscar", () => {
    const rutaEnElRegistro = new Map(MODULES.map((item) => [item.href, item.href]));
    for (const circle of moduleCircles(SIN_DECISIONES, SIN_DECISIONES)) {
      expect(circle.href).toBe(rutaEnElRegistro.get(circle.key));
    }
  });

  /**
   * La otra mitad del mismo pedido, dicha en negativo — y es la que atrapa una
   * vuelta atrás sin querer. Un `?tab=` acá significa que dos círculos con el
   * mismo nombre y el mismo ícono (éste y el de /buscar) volvieron a entregar
   * cosas distintas, que es exactamente lo que el cliente señaló.
   */
  it("ningún círculo filtra el feed: se acabaron los `?tab=`", () => {
    for (const circle of moduleCircles(SIN_DECISIONES, SIN_DECISIONES)) {
      expect(circle.href).not.toContain("?tab=");
    }
  });

  /**
   * El otro sentido del contrato: los tabs del feed siguen EXISTIENDO aunque
   * ningún círculo los abra. Un link viejo —compartido por WhatsApp, guardado,
   * indexado— tiene que seguir mostrando lo mismo. Lo que se sacó es la puerta
   * visual, no la ruta.
   */
  it("los tabs del feed siguen siendo válidos aunque ya no tengan círculo", () => {
    for (const tab of FEED_TABS) {
      expect(parseTab(tab.id)).toBe(tab.id);
    }
  });

  it("el feed es el único círculo que puede decir 'estás acá'", () => {
    const circles = moduleCircles(SIN_DECISIONES, SIN_DECISIONES);
    expect(
      circles.filter((circle) => circle.esElFeed).map((circle) => circle.href),
    ).toEqual(["/feed"]);
  });

  it("Videos no ocupa lugar: ya es una pestaña del bottom nav", () => {
    const circles = moduleCircles(SIN_DECISIONES, SIN_DECISIONES);
    expect(circles.map((circle) => circle.key)).not.toContain("/videos");
  });

  it("un módulo en 'muy pronto' se ve, lleva a su ruta y trae su estado", () => {
    const circles = moduleCircles({ eventos: false }, { eventos: true });
    const eventos = circles.find((circle) => circle.key === "/eventos");
    expect(eventos?.href).toBe("/eventos");
    expect(eventos?.state).toBe("soon");
  });
});

describe("ModuleCircles", () => {
  afterEach(cleanup);

  /**
   * REGRESIÓN (cliente 2026-08-20): "una barrita del color del tema que viene
   * desde abajo del todo" al clickear un círculo en la compu.
   *
   * No era el anillo. La fila llamaba `scrollIntoView({ block: "nearest" })`,
   * que mira también el eje VERTICAL y pegaba un salto de PÁGINA cuando la fila
   * había quedado fuera de vista (o sea, cada vez que alguien venía scrolleando
   * el feed). El anillo se anima con `layoutId` —midiendo la posición antes y
   * después—, así que ese salto entraba en la medición y lo hacía cruzar la
   * pantalla en diagonal.
   *
   * Lo que se fija acá es la causa, no el síntoma: montar la fila no llama NADA
   * que pueda mover el scroll vertical del documento.
   */
  it("traer a la vista el círculo marcado NO puede mover la página en vertical", () => {
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;

    renderRow("para-ti");

    expect(intoView).not.toHaveBeenCalled();
  });

  it("cada círculo lleva adonde promete su nombre — a su sección, como en /buscar", () => {
    renderRow();
    expect(hrefs()).toEqual([
      "/feed",
      "/propiedades",
      "/eventos",
      "/negocios",
      "/profesionales",
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

  /**
   * Los dos grupos y el hairline se fueron con el pedido del cliente: ya no hay
   * dos clases de círculo que distinguir, así que anunciar dos listas sería
   * describirle a quien escucha una diferencia que no existe.
   */
  it("es UNA sola fila, con un solo nombre accesible", () => {
    renderRow();
    expect(screen.getAllByRole("list")).toHaveLength(1);
    expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe(
      COPY.modules.ariaLabel,
    );
  });

  it("marca aria-current='page' en el feed, y en uno solo", () => {
    renderRow("para-ti");
    const marcados = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(marcados).toHaveLength(1);
    expect(marcados[0]?.getAttribute("href")).toBe("/feed");
  });

  /**
   * "Siguiendo" es el mismo feed visto con otro lente: el círculo sigue MARCADO
   * (estás en el feed) pero la URL no es `/feed` pelada, así que `aria-current`
   * —que afirma "esta ES la página"— no se puede poner. La distinción entre las
   * dos señales ya existía en el componente y acá queda anclada.
   */
  it("en 'Siguiendo' el círculo del feed se marca, pero no dice ser la página", () => {
    renderRow("siguiendo");
    const feed = screen.getByRole("link", { name: COPY.modules.paraTi });
    expect(feed.getAttribute("aria-current")).toBeNull();
    expect(anillo(feed)).not.toBeNull();
  });

  it("el marcado se distingue por forma, no sólo por color", () => {
    renderRow("para-ti");
    const activo = screen.getByRole("link", { name: COPY.modules.paraTi });
    // El anillo (span extra dentro del enlace) y el peso del nombre: las dos
    // señales sobreviven a una pantalla en escala de grises.
    expect(anillo(activo)).not.toBeNull();
    expect(activo.innerHTML).toContain("font-semibold");
  });

  it("ninguna sección se marca: no son el estado de esta pantalla", () => {
    renderRow("para-ti");
    const empleos = screen.getByRole("link", { name: t("nav", "moduleEmpleos") });
    expect(empleos.getAttribute("aria-current")).toBeNull();
    expect(anillo(empleos)).toBeNull();
  });

  it("un módulo apagado desde el panel no aparece", () => {
    renderRow("para-ti", { marketplace: false, creadores: false }, {});
    expect(hrefs()).not.toContain("/marketplace");
    expect(hrefs()).not.toContain("/creadores");
    expect(screen.queryByRole("link", { name: t("nav", "moduleMarketplace") })).toBeNull();
  });

  it("apagar una vertical le saca el círculo, no sólo el contenido", () => {
    renderRow("para-ti", { eventos: false }, {});
    expect(hrefs()).not.toContain("/eventos");
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

  it("con la config vacía (DB caída / comunidad nueva) la fila sale entera", () => {
    // Ausente = activo: un hueco de configuración no puede parecerse a una
    // decisión de producto (ver shell/module-access.ts).
    renderRow("para-ti", null, null);
    // 9 = los diez módulos del registro menos Videos, que ya es pestaña del
    // bottom nav.
    expect(screen.getAllByRole("link")).toHaveLength(9);
  });
});

/**
 * `feedTabHref` ya no la usa la fila (ningún círculo filtra), pero los `?tab=`
 * siguen existiendo como rutas y esta función sigue siendo dónde está escrita su
 * forma. El test se queda por eso: si alguien le cambia la forma, se entera acá
 * y no cuando un link viejo deja de abrir lo que prometía.
 */
describe("feedTabHref", () => {
  it("el feed sin filtrar no arrastra query", () => {
    expect(feedTabHref("para-ti")).toBe("/feed");
  });

  it("los demás tabs viven en la URL, como siempre", () => {
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
