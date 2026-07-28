// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

/**
 * El control de tres estados de los módulos.
 *
 * Lo que fija: que el estado GUARDADO se lee bien en pantalla (si alguien dejó
 * "Muy pronto" y al abrir la pantalla ve "Oculto", el próximo Guardar apaga la
 * sección sin querer), que los tres estados son EXCLUYENTES (radios, no
 * checkboxes: "Activo + Muy pronto" no se puede ni proponer) y —lo más
 * importante— que esta pantalla ofrece EXACTAMENTE las claves que la action
 * guarda: una de menos y el módulo se apaga solo en el próximo Guardar.
 */

vi.mock("@/app/admin/dominio/actions", () => ({
  updateTenantModules: vi.fn(),
}));

import { ModuleToggles } from "./module-toggles";
import { MODULE_KEYS, moduleStateOf } from "@/app/admin/dominio/modules";

afterEach(cleanup);

/** Las tres píldoras de un módulo, por su name en el form. */
function radiosOf(key: string): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[name="module:${key}"]`),
  );
}

function checkedValueOf(key: string): string | undefined {
  return radiosOf(key).find((radio) => radio.checked)?.value;
}

describe("moduleStateOf", () => {
  it("prendido = Activo, y modules_soon se ignora", () => {
    expect(moduleStateOf("feed", { feed: true }, { feed: true })).toBe("on");
  });

  it("apagado + soon = Muy pronto", () => {
    expect(moduleStateOf("marketplace", { marketplace: false }, { marketplace: true })).toBe(
      "soon",
    );
  });

  it("apagado sin soon = Oculto", () => {
    expect(moduleStateOf("creadores", { creadores: false }, {})).toBe("off");
  });

  it("ausente = Activo — y es el MISMO default que usa la app", () => {
    // La contraparte está en shell/module-access.test.ts: acá solo se fija que
    // el panel no vuelva a derivar su propio estado. Cuando lo hacía, marcaba
    // "Activo" secciones que la app estaba escondiendo.
    expect(moduleStateOf("eventos", {}, {})).toBe("on");
    expect(moduleStateOf("eventos", null, null)).toBe("on");
  });
});

/**
 * El guard que faltaba. `updateTenantModules` recorre MODULE_KEYS y hace
 * `formData.get("module:" + key)`; si esta pantalla no dibuja un control para
 * esa clave, el get devuelve null, el zod lo lleva a "off" y el módulo se APAGA
 * SOLO en el próximo guardado — sin que nadie lo haya tocado y sin un mensaje
 * que lo explique. Al revés (un control que la action no mira) es un interruptor
 * inerte: el operador lo mueve, guarda, y no pasa nada.
 */
describe("<ModuleToggles /> ↔ MODULE_KEYS (lo que se dibuja es lo que se guarda)", () => {
  it("dibuja un control por cada clave que la action guarda", () => {
    const { container } = render(<ModuleToggles modules={{}} />);

    for (const key of MODULE_KEYS) {
      expect(
        container.querySelector(`input[name="module:${key}"]`),
        `"${key}" está en MODULE_KEYS pero el panel no la ofrece: se apagaría sola al guardar`,
      ).not.toBeNull();
    }
  });

  it("no ofrece ningún interruptor que la action ignore", () => {
    const { container } = render(<ModuleToggles modules={{}} />);

    const dibujadas = new Set(
      Array.from(container.querySelectorAll<HTMLInputElement>('input[name^="module:"]')).map(
        (input) => input.name.slice("module:".length),
      ),
    );

    for (const key of dibujadas) {
      expect(
        MODULE_KEYS as readonly string[],
        `"${key}" tiene interruptor pero la action no lo guarda: el operador lo mueve y no pasa nada`,
      ).toContain(key);
    }
    expect(dibujadas.size).toBe(MODULE_KEYS.length);
  });
});

describe("<ModuleToggles />", () => {
  it("marca el estado guardado de cada módulo", () => {
    render(
      <ModuleToggles
        modules={{ feed: true, marketplace: false, creadores: false }}
        modulesSoon={{ marketplace: true }}
      />,
    );

    expect(checkedValueOf("marketplace")).toBe("soon");
    expect(checkedValueOf("creadores")).toBe("off");
  });

  it("las secciones que la app no deja apagar no ofrecen interruptor", () => {
    const { container } = render(<ModuleToggles modules={{ feed: false, mensajes: false }} />);

    // Un radio acá sería mentirle al operador: shell/module-access.ts las fuerza
    // a "active" pase lo que pase (ALWAYS_ON_MODULE_KEYS).
    for (const key of ["feed", "mensajes"]) {
      // `radiosOf` busca por name, así que el hidden también cae: lo que importa
      // es que NO haya ningún radio elegible.
      expect(radiosOf(key).filter((input) => input.type === "radio")).toHaveLength(0);
      const oculto = container.querySelector<HTMLInputElement>(
        `input[type="hidden"][name="module:${key}"]`,
      );
      // Se envía "on" igual: guardar normaliza el `false` viejo de la base en
      // vez de dejarlo contradiciendo a la app para siempre.
      expect(oculto?.value).toBe("on");
    }

    expect(screen.getAllByText("Siempre activo")).toHaveLength(2);
  });

  it("cada módulo ofrece exactamente tres opciones excluyentes", () => {
    render(<ModuleToggles modules={{}} />);

    const radios = radiosOf("negocios");
    expect(radios).toHaveLength(3);
    expect(radios.map((radio) => radio.value)).toEqual(["on", "soon", "off"]);
    expect(radios.every((radio) => radio.type === "radio")).toBe(true);
    // Un solo estado seleccionado a la vez: enabled && soon es inexpresable.
    expect(radios.filter((radio) => radio.checked)).toHaveLength(1);
  });

  it("sin `modulesSoon` nada queda en Muy pronto: lo apagado se muestra apagado", () => {
    render(<ModuleToggles modules={{ marketplace: false }} />);

    expect(checkedValueOf("marketplace")).toBe("off");
  });

  it("cada módulo es un grupo etiquetado, legible con lector de pantalla", () => {
    render(<ModuleToggles modules={{}} modulesSoon={{}} />);

    const group = screen.getByRole("group", { name: /Vivienda/ });
    expect(within(group).getByLabelText("Activo")).toBeDefined();
    expect(within(group).getByLabelText("Muy pronto")).toBeDefined();
    expect(within(group).getByLabelText("Oculto")).toBeDefined();
  });

  it("administra TODAS las secciones vivas de la app, incluidas Empleos y Videos", () => {
    render(<ModuleToggles modules={{}} />);

    // Una sección que existe en la app pero no acá es una sección que el
    // operador no puede apagar ni anunciar — el panel quedaría incompleto.
    expect(screen.getByRole("group", { name: /Empleos/ })).toBeDefined();
    expect(screen.getByRole("group", { name: /Videos/ })).toBeDefined();
  });

  it("el copy explica los tres estados sin jerga técnica", () => {
    render(<ModuleToggles modules={{}} />);

    // 10 módulos administrables − los 2 que no se pueden apagar = 8 con las tres opciones.
    expect(screen.getAllByLabelText("Muy pronto")).toHaveLength(8);
    expect(screen.getAllByTitle("Se ve, pero todavía no se entra").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("No aparece en la app").length).toBeGreaterThan(0);
  });
});
