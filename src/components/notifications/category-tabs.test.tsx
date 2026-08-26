// @vitest-environment jsdom
// Único archivo del repo que usa los matchers de jest-dom (`toHaveAttribute`,
// `toHaveTextContent`): el resto asevera con `getAttribute()` pelado. Se
// importa acá y no en una config global para no cambiarle el entorno a los
// otros 76 archivos de test por una sola necesidad.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CATEGORY_META } from "@/lib/notifications/categories";
import { INBOX_PANEL_ID } from "@/lib/notifications/href";
import { CategoryTabs } from "./category-tabs";
import { COPY } from "./copy";

/**
 * Las etiquetas se leen de `CATEGORY_META` y no se escriben a mano: la CLAVE de
 * categoría (`trabajos`, `propiedades`) es un valor persistido y por eso se
 * asevera literal en los `href`; el TEXTO que se ve es copy y puede cambiar
 * —pasó: "Trabajos" y "Propiedades" se alinearon con "Empleos" y "Vivienda" del
 * menú principal—. Atar el test al literal hacía fallar tres casos que no
 * estaban probando copy, sino tabindex, contadores y enlaces.
 */
const LABEL = {
  trabajos: CATEGORY_META.trabajos.label,
  propiedades: CATEGORY_META.propiedades.label,
} as const;

/**
 * Las pestañas en pantalla. Lo que este archivo ancla:
 *  1. el patrón ARIA `tabs` completo (tablist / tab / aria-selected /
 *     aria-controls) sobre ENLACES, que es lo que hace que cada categoría sea
 *     una dirección real;
 *  2. el roving tabindex: una sola parada de tabulación para toda la tira;
 *  3. las flechas mueven el FOCO y NO navegan (activación manual — cada cambio
 *     de pestaña es una consulta al servidor);
 *  4. los contadores salen de una sola fuente y se anuncian con palabras;
 *  5. una categoría de "Más" seleccionada se dibuja como pestaña: el estado
 *     siempre tiene dónde vivir.
 */

/**
 * `m.span` con `layoutId` necesita el contexto de LazyMotion, que en la app vive
 * en el layout. Se reemplaza por un <span> pelado; el resto de motion/react
 * (`useReducedMotion`, `AnimatePresence`, que usa BottomSheet) queda real.
 */
vi.mock("motion/react", async () =>
  (await import("@/test/motion-mock")).motionMock(),
);

const COUNTS = { mensajes: 3, trabajos: 12, pagos: 1 } as const;

function mount(overrides: Partial<React.ComponentProps<typeof CategoryTabs>> = {}) {
  return render(
    <CategoryTabs
      active="todas"
      filter="todas"
      counts={COUNTS}
      totalUnread={16}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe("patrón ARIA", () => {
  it("hay un tablist rotulado con pestañas que apuntan al panel", () => {
    mount();
    const list = screen.getByRole("tablist", { name: COPY.tabs.label });
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(1);
    for (const tab of tabs) {
      expect(tab).toHaveAttribute("aria-controls", INBOX_PANEL_ID);
      // Son enlaces: la pestaña es una dirección, no un estado de cliente.
      expect(tab.tagName).toBe("A");
      expect(tab).toHaveAttribute("href");
    }
  });

  it("sólo la pestaña activa está seleccionada", () => {
    mount({ active: "mensajes" });
    const selected = screen.getAllByRole("tab").filter(
      (tab) => tab.getAttribute("aria-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("Mensajes");
  });

  it("roving tabindex: una sola parada de tabulación en toda la tira", () => {
    mount({ active: "trabajos" });
    const focusable = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(1);
    expect(focusable[0]).toHaveTextContent(LABEL.trabajos);
  });
});

describe("teclado", () => {
  it("las flechas mueven el foco sin navegar", () => {
    mount();
    const list = screen.getByRole("tablist");
    const tabs = within(list).getAllByRole("tab");
    tabs[0].focus();

    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs[1]);
    // Nada cambió de estado: activación MANUAL (Enter/Espacio navega el enlace).
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("Home y End van a los extremos", () => {
    mount();
    const list = screen.getByRole("tablist");
    const tabs = within(list).getAllByRole("tab");
    tabs[0].focus();

    fireEvent.keyDown(list, { key: "End" });
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);

    fireEvent.keyDown(list, { key: "Home" });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("la flecha da la vuelta al llegar al final", () => {
    mount();
    const list = screen.getByRole("tablist");
    const tabs = within(list).getAllByRole("tab");
    tabs[tabs.length - 1].focus();
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs[0]);
  });
});

describe("contadores", () => {
  it("el número va acompañado de palabras para el lector de pantalla", () => {
    mount();
    const tab = screen.getByRole("tab", { name: /Mensajes/ });
    expect(tab).toHaveTextContent("3");
    expect(tab.textContent).toContain(COPY.tabs.unreadSuffix(3));
  });

  it("una categoría sin no leídas no dibuja contador", () => {
    mount();
    const tab = screen.getByRole("tab", { name: new RegExp(LABEL.propiedades) });
    expect(tab.textContent).not.toMatch(/\d/);
  });

  it("'Más' suma las no leídas de las categorías que esconde", () => {
    mount();
    // pagos: 1 es la única de "Más" con algo.
    const more = screen.getByRole("button", { name: COPY.tabs.moreLabel });
    expect(more).toHaveTextContent("1");
  });
});

describe("la pestaña activa de 'Más'", () => {
  it("se dibuja como pestaña propia en vez de dejar la tira sin selección", () => {
    mount({ active: "pagos" });
    const tab = screen.getByRole("tab", { name: /Pagos/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
  });

  it("y entonces 'Más' deja de mostrar ese contador (ya está a la vista)", () => {
    mount({ active: "pagos" });
    const more = screen.getByRole("button", { name: COPY.tabs.moreLabel });
    expect(more.textContent).not.toMatch(/\d/);
  });
});

describe("enlaces", () => {
  it("cada pestaña conserva el filtro activo", () => {
    mount({ filter: "no-leidas" });
    const tab = screen.getByRole("tab", { name: new RegExp(LABEL.trabajos) });
    // El `c=trabajos` del href SÍ va literal: es la clave persistida.
    expect(tab).toHaveAttribute("href", "/notificaciones?c=trabajos&f=no-leidas");
  });

  it("'Todas' vuelve a la URL canónica, sin parámetros de más", () => {
    mount();
    const tab = screen.getByRole("tab", { name: /Todas/ });
    expect(tab).toHaveAttribute("href", "/notificaciones");
  });
});
