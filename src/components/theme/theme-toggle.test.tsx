// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { THEME_STORAGE_KEY } from "./constants";

/**
 * Lo que se protege acá es el defecto [10]: `aria-pressed={isDark}` afirmaba una
 * elección del usuario que con `theme='system'` nunca existió. El nombre-como-acción
 * y la descripción (SO vs. usuario) son el reemplazo honesto.
 *
 * El toggle es un claro↔oscuro simple: la primera elección deja de seguir al SO y
 * persiste; NO hay UI para volver a `system` (el viejo botón "Seguir al sistema"
 * se quitó). El ancla de regresión de abajo fija que ese botón no reaparezca.
 *
 * El store es un módulo con estado singleton: cada test lo importa de cero a
 * través del componente (`vi.resetModules()` + import dinámico).
 */

type MediaListener = (event: MediaQueryListEvent) => void;

let systemDark = false;
const mediaListeners = new Set<MediaListener>();

/** matchMedia falso que además puede DISPARAR el cambio de tema del SO. */
function stubMatchMedia(dark: boolean): void {
  systemDark = dark;
  mediaListeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return systemDark;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: MediaListener) => {
      mediaListeners.add(listener);
    },
    removeEventListener: (_type: string, listener: MediaListener) => {
      mediaListeners.delete(listener);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

async function renderToggle(className?: string) {
  const { ThemeToggle } = await import("./theme-toggle");
  return render(<ThemeToggle className={className} />);
}

/** Los dos nombres del toggle empiezan con "Cambiar". */
const toggleButton = () => screen.getByRole("button", { name: /^Cambiar/ });
/** El botón quitado. Debe seguir sin existir en cualquier estado. */
const systemButton = () => screen.queryByRole("button", { name: "Seguir al sistema" });
const themeClass = () => document.documentElement.className;

/** El texto que un lector de pantalla lee DESPUÉS del nombre y el rol. */
function description(element: HTMLElement): string | null {
  const id = element.getAttribute("aria-describedby");
  if (id !== null) return document.getElementById(id)?.textContent ?? null;
  // accname §4.3.2: sin `aria-describedby`, un `title` que no se usó para el
  // nombre pasa a ser la DESCRIPCIÓN. Con `aria-label` presente, siempre.
  return element.getAttribute("title");
}

beforeEach(() => {
  vi.resetModules();
  document.documentElement.className = "";
  window.localStorage.clear();
  mediaListeners.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThemeToggle: el nombre y el estado dicen la verdad", () => {
  it("en el HTML del server no afirma nada: no sabe el tema", async () => {
    stubMatchMedia(true);
    const { renderToString } = await import("react-dom/server");
    const { ThemeToggle } = await import("./theme-toggle");

    const html = renderToString(<ThemeToggle />);

    // Ni estado, ni promesa de destino.
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("aria-describedby");
    expect(html).toContain('aria-label="Cambiar el tema"');
    // Y ningún `title`: sin `aria-describedby` que lo suprima, un title igual al
    // `aria-label` se convierte en la descripción y el lector lo dice dos veces.
    expect(html).not.toContain("title=");
  });

  it("con theme='system' y SO oscuro: nunca dice 'activado', dice de quién es el tema", async () => {
    stubMatchMedia(true);
    await renderToggle();

    const button = toggleButton();
    // EL defecto: antes acá salía aria-pressed="true" sobre una elección inexistente.
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Cambiar a tema claro");
    expect(description(button)).toBe("Ahora seguís el tema oscuro del sistema.");
  });

  it("con theme='system' y SO claro: la descripción sigue al SO", async () => {
    stubMatchMedia(false);
    await renderToggle();

    const button = toggleButton();
    expect(button.getAttribute("aria-label")).toBe("Cambiar a tema oscuro");
    expect(description(button)).toBe("Ahora seguís el tema claro del sistema.");
  });

  it("con preferencia explícita la descripción se la atribuye al usuario", async () => {
    stubMatchMedia(true);
    await renderToggle();

    fireEvent.click(toggleButton()); // resuelto oscuro → elige claro

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(themeClass()).toBe("light");

    const button = toggleButton();
    expect(button.getAttribute("aria-label")).toBe("Cambiar a tema oscuro");
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(description(button)).toBe("Elegiste el tema claro.");
  });

  it("ningún estado emite aria-pressed (ancla de regresión)", async () => {
    stubMatchMedia(false);
    const { container } = await renderToggle();

    expect(container.querySelector("[aria-pressed]")).toBeNull(); // system
    fireEvent.click(toggleButton());
    expect(container.querySelector("[aria-pressed]")).toBeNull(); // dark explícito
    fireEvent.click(toggleButton());
    expect(container.querySelector("[aria-pressed]")).toBeNull(); // light explícito
  });
});

describe("ThemeToggle: no hay vuelta a 'system' desde la UI", () => {
  it("no monta el botón 'Seguir al sistema' en ningún estado", async () => {
    stubMatchMedia(true);
    await renderToggle();
    expect(systemButton()).toBeNull(); // theme='system'

    fireEvent.click(toggleButton()); // → claro explícito
    expect(systemButton()).toBeNull();

    fireEvent.click(toggleButton()); // → oscuro explícito
    expect(systemButton()).toBeNull();
  });

  it("hay un solo botón: el sol/luna", async () => {
    stubMatchMedia(true);
    await renderToggle();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.click(toggleButton()); // elegir tema no agrega controles
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("ThemeToggle: contrato con los call sites", () => {
  it("el className del call site va al contenedor (lo posiciona el layout de auth)", async () => {
    stubMatchMedia(false);
    const { container } = await renderToggle("absolute right-2 z-10");

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("absolute");
    expect(wrapper.className).toContain("right-2");
    // Sigue siendo una fila alineada.
    expect(wrapper.className).toContain("flex");
    expect(wrapper.className).toContain("shrink-0");
  });

  it("el botón es 44×44 (§3.2)", async () => {
    stubMatchMedia(true);
    await renderToggle();

    expect(toggleButton().className).toContain("size-11");
  });
});
