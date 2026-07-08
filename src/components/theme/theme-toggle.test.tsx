// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { THEME_STORAGE_KEY } from "./constants";

/**
 * Lo que se protege acá es el defecto [10]: `aria-pressed={isDark}` afirmaba una
 * elección del usuario que con `theme='system'` nunca existió, y `setTheme('system')`
 * no tenía un solo call site — una vez que tocabas el toggle quedabas clavado en
 * preferencia explícita para siempre.
 *
 * Y su daño colateral: el botón "Seguir al sistema" se DESMONTA con el click que
 * lo activa. La primera versión de este archivo anclaba `expect(systemButton())
 * .toBeNull()` sin mirar nunca `document.activeElement`, así que pasaba con el
 * foco tirado en el <body> (WCAG 2.4.3) y con la descripción —lo único que
 * anuncia el tercer estado— actualizándose sobre un botón que ya no tenía el
 * foco. Los tests de "el foco y el anuncio" existen para que eso no vuelva.
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

/** El SO cambia de tema en vivo (atardecer, modo automático de Android). */
async function flipSystem(dark: boolean): Promise<void> {
  systemDark = dark;
  await act(async () => {
    for (const listener of mediaListeners) listener({ matches: dark } as MediaQueryListEvent);
  });
}

/** SecurityError: en estos navegadores lanza TODO acceso, no sólo la escritura. */
function blockStorage(): void {
  const boom = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
}

async function renderToggle(className?: string) {
  const { ThemeToggle } = await import("./theme-toggle");
  return render(<ThemeToggle className={className} />);
}

/** Los dos nombres del toggle empiezan con "Cambiar"; el otro botón, no. */
const toggleButton = () => screen.getByRole("button", { name: /^Cambiar/ });
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

/** Clic de navegador de verdad: el botón recibe el foco antes de activarse. */
function clickWithFocus(button: HTMLElement): void {
  button.focus();
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
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

    // Ni estado, ni promesa de destino, ni una salida a `system` que el server
    // no puede saber si hace falta.
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("Seguir al sistema");
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
    // No hay nada que devolver: ya seguís al sistema.
    expect(systemButton()).toBeNull();
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

describe("ThemeToggle: la vuelta a 'system'", () => {
  it("el botón aparece sólo cuando hay una preferencia que soltar", async () => {
    stubMatchMedia(true);
    await renderToggle();
    expect(systemButton()).toBeNull();

    fireEvent.click(toggleButton());
    expect(systemButton()).not.toBeNull();
  });

  it("va ANTES del sol/luna en el DOM: el control primario no se corre del dedo", async () => {
    stubMatchMedia(true);
    await renderToggle();
    fireEvent.click(toggleButton());

    const [first, second] = screen.getAllByRole("button");
    expect(first.getAttribute("aria-label")).toBe("Seguir al sistema");
    expect(second.getAttribute("aria-label")).toBe("Cambiar a tema oscuro");
  });

  it("borra la preferencia, vuelve a seguir al SO y el botón se va solo", async () => {
    stubMatchMedia(true);
    await renderToggle();

    fireEvent.click(toggleButton()); // → claro explícito
    expect(themeClass()).toBe("light");

    clickWithFocus(systemButton()!);

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(themeClass()).toBe("dark"); // el SO manda de nuevo
    expect(systemButton()).toBeNull();
    expect(description(toggleButton())).toBe("Ahora seguís el tema oscuro del sistema.");
  });

  it("después de volver, el SO sigue mandando EN VIVO", async () => {
    stubMatchMedia(true);
    await renderToggle();
    fireEvent.click(toggleButton());
    clickWithFocus(systemButton()!);

    await flipSystem(false); // atardecer al revés

    expect(themeClass()).toBe("light");
    expect(description(toggleButton())).toBe("Ahora seguís el tema claro del sistema.");
    expect(systemButton()).toBeNull();
  });

  it("con localStorage bloqueado la salida sigue existiendo (memoryTheme)", async () => {
    stubMatchMedia(true);
    blockStorage();
    await renderToggle();

    fireEvent.click(toggleButton()); // no persiste, pero el tema cambia
    expect(themeClass()).toBe("light");
    expect(systemButton()).not.toBeNull();

    clickWithFocus(systemButton()!); // memoryTheme = 'system'
    expect(themeClass()).toBe("dark");
    expect(systemButton()).toBeNull();
    expect(document.activeElement).toBe(toggleButton()); // ni con el storage roto

    await flipSystem(false); // y el listener del SO sigue vivo
    expect(themeClass()).toBe("light");
  });
});

describe("ThemeToggle: el foco y el anuncio al volver a 'system'", () => {
  it("el botón se desmonta con el click que lo activa y le entrega el foco al sol/luna", async () => {
    stubMatchMedia(true);
    await renderToggle();
    fireEvent.click(toggleButton()); // → claro explícito

    const system = systemButton()!;
    clickWithFocus(system);

    // El foco NO se cae al <body>: el siguiente Tab sigue desde el sol/luna y no
    // reinicia desde el principio de la página (WCAG 2.4.3, Focus Order).
    expect(document.body.contains(system)).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(toggleButton());
  });

  it("cuando el `focus` dispara, la descripción YA anuncia el estado nuevo", async () => {
    // El caso MÁS común: el SO está en claro y la preferencia explícita también.
    // Ni el tema, ni la clase de <html>, ni el nombre del control cambian. El
    // único testigo del cambio es la descripción del control que recibe el foco.
    stubMatchMedia(false);
    await renderToggle();

    fireEvent.click(toggleButton()); // → oscuro explícito
    fireEvent.click(toggleButton()); // → claro explícito (idéntico al del SO)
    expect(themeClass()).toBe("light");

    const toggle = toggleButton();
    // Lo que un lector de pantalla tiene disponible EN EL INSTANTE del `focus`.
    // Si el commit de React llegara después (sin `flushSync`), acá se leería
    // todavía "Elegiste el tema claro." y el tercer estado sería inaudible.
    let heardOnFocus: string | null = null;
    toggle.addEventListener("focus", () => {
      heardOnFocus = description(toggle);
    });

    clickWithFocus(systemButton()!);

    expect(themeClass()).toBe("light"); // nada cambió en pantalla…
    expect(toggle.getAttribute("aria-label")).toBe("Cambiar a tema oscuro"); // …ni el nombre
    expect(document.activeElement).toBe(toggle);
    expect(heardOnFocus).toBe("Ahora seguís el tema claro del sistema.");
  });

  it("'Seguir al sistema' no repite su nombre como descripción", async () => {
    stubMatchMedia(true);
    await renderToggle();
    fireEvent.click(toggleButton()); // → claro explícito

    const system = systemButton()!;
    // Con `aria-label` puesto, un `title` idéntico sería la descripción accesible:
    // "Seguir al sistema, botón, Seguir al sistema". El `aria-describedby` lo tapa
    // y aprovecha para decir qué preferencia se está soltando.
    expect(system.hasAttribute("aria-describedby")).toBe(true);
    expect(description(system)).toBe("Elegiste el tema claro.");
    expect(description(system)).not.toBe(system.getAttribute("aria-label"));
  });

  it("no hay live region: el anuncio viaja en el cambio de foco", async () => {
    stubMatchMedia(true);
    const { container } = await renderToggle();
    fireEvent.click(toggleButton());
    clickWithFocus(systemButton()!);

    // `role="status"` acá duplicaría el anuncio del foco y, montándose al hidratar,
    // hablaría en cada carga. 4.1.3 no aplica: el cambio de estado SÍ recibe foco.
    expect(container.querySelector('[role="status"], [aria-live]')).toBeNull();
  });
});

describe("ThemeToggle: contrato con los call sites", () => {
  it("el className del call site va al contenedor (lo posiciona el layout de auth)", async () => {
    stubMatchMedia(false);
    const { container } = await renderToggle("absolute right-2 z-10");

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("absolute");
    expect(wrapper.className).toContain("right-2");
    // Sigue siendo una fila: el par de botones no se apila ni se encoge.
    expect(wrapper.className).toContain("flex");
    expect(wrapper.className).toContain("shrink-0");
  });

  it("los dos botones son 44×44 (§3.2)", async () => {
    stubMatchMedia(true);
    await renderToggle();
    fireEvent.click(toggleButton());

    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("size-11");
    }
  });
});
