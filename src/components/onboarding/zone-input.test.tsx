// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ZoneInput } from "./zone-input";

/**
 * Lo que fija: el camino de TECLADO, que era el que estaba roto.
 *
 * El bug: el `onBlur` del input programaba cerrar la lista a los 120 ms. Al
 * tabular del campo a una sugerencia, el input perdía el foco, 120 ms después
 * la lista pasaba a `display:none` y el botón que acababa de recibir el foco
 * desaparecía del layout — el navegador tiraba el foco al <body>, así que no se
 * podía elegir ninguna zona sin mouse. Con mouse no se veía nunca, porque el
 * `onMouseDown` con `preventDefault` retiene el foco en el input: un test hecho
 * a base de clicks pasaba igual con el bug puesto. Por eso acá se mira
 * `relatedTarget`, que es la señal exacta que el componente usa para decidir.
 *
 * Dos cosas del entorno que no son obvias:
 * - El `focus()` nativo se envuelve en `act()`. React 19 no vacía la cola de
 *   estado de un evento disparado fuera de `act()`, así que sin eso se leería
 *   el DOM anterior al re-render y el test mentiría.
 * - Se afirma sobre la CLASE y no con `toBeVisible()`: en jsdom no hay hoja de
 *   estilos, la clase `hidden` de Tailwind no cambia el estilo computado y
 *   cualquier chequeo de visibilidad daría verde siempre.
 */
afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState("");
  return <ZoneInput id="zona" value={value} onChange={setValue} />;
}

const campo = () => screen.getByRole("textbox") as HTMLInputElement;
const primeraZona = () => screen.getByRole("button", { name: "Corona, Queens" });
const sugerenciasAbiertas = () =>
  !screen.getByLabelText("Zonas sugeridas").className.split(/\s+/).includes("hidden");

function enfocar(el: HTMLElement) {
  act(() => {
    el.focus();
  });
}

describe("ZoneInput — foco con teclado", () => {
  it("mantiene las sugerencias abiertas cuando el foco pasa del campo a una sugerencia", () => {
    // Timers falsos a propósito: el cierre viejo era diferido 120 ms. Sin
    // adelantar el reloj, este test pasaba con el bug puesto — la lista todavía
    // no se había cerrado cuando corría la afirmación.
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const input = campo();

      enfocar(input);
      expect(sugerenciasAbiertas()).toBe(true);

      // Tabular = el foco sale del campo pero SIGUE adentro del componente.
      fireEvent.blur(input, { relatedTarget: primeraZona() });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(sugerenciasAbiertas()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cierra las sugerencias cuando el foco se va del componente", () => {
    render(<Harness />);
    const input = campo();
    const afuera = document.createElement("button");
    document.body.appendChild(afuera);

    try {
      enfocar(input);
      expect(sugerenciasAbiertas()).toBe(true);

      fireEvent.blur(input, { relatedTarget: afuera });
      expect(sugerenciasAbiertas()).toBe(false);
    } finally {
      afuera.remove();
    }
  });

  it("al elegir una zona devuelve el foco al campo", () => {
    render(<Harness />);
    const input = campo();

    enfocar(input);
    fireEvent.click(primeraZona());

    expect(input.value).toBe("Corona, Queens");
    // Sin devolver el foco, quedaba en un botón que se acababa de ocultar.
    expect(document.activeElement).toBe(input);
  });

  it("Escape cierra las sugerencias sin sacar el foco del campo", () => {
    render(<Harness />);
    const input = campo();

    enfocar(input);
    expect(sugerenciasAbiertas()).toBe(true);

    fireEvent.keyDown(input, { key: "Escape" });

    expect(sugerenciasAbiertas()).toBe(false);
    expect(document.activeElement).toBe(input);
  });
});

describe("ZoneInput — semántica", () => {
  it("no anuncia un combobox que no sabe navegar con flechas", () => {
    render(<Harness />);
    // El rol prometía `aria-activedescendant` y flechas que nunca se
    // implementaron; y un role="option" no puede contener un <button>.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ofrece las 6 zonas como botones alcanzables por su nombre", () => {
    render(<Harness />);
    enfocar(campo());
    expect(screen.getAllByRole("button")).toHaveLength(6);
  });

  it("filtra mientras se escribe", () => {
    render(<Harness />);
    const input = campo();

    enfocar(input);
    fireEvent.change(input, { target: { value: "flush" } });

    expect(screen.getByRole("button", { name: "Flushing, Queens" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Astoria, Queens" })).toBeNull();
  });
});
