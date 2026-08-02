// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Input } from "./input";

/**
 * El primitivo `Input` tipaba sus props como `InputHTMLAttributes`, que NO
 * incluye `ref`. Consecuencia real: quien necesitaba enfocar o medir el campo
 * —el autocompletado de zona del onboarding, por ejemplo— tenía que colgar el
 * ref de un `<div>` contenedor y salir a buscar el input desde ahí.
 *
 * Este test existe para que eso no vuelva: en React 19 `ref` es una prop más y
 * tiene que llegar al nodo del DOM. Es lo único que un typecheck no prueba —
 * que los tipos acepten `ref` no garantiza que el componente lo reenvíe.
 */

afterEach(cleanup);

describe("Input", () => {
  it("reenvía el ref al <input> real del DOM", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="Tu zona" defaultValue="Queens" />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(screen.getByLabelText("Tu zona"));
    expect(ref.current?.value).toBe("Queens");
  });

  it("el ref sirve para enfocar el campo, que es para lo que se pedía", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="Tu zona" />);

    ref.current?.focus();

    expect(document.activeElement).toBe(screen.getByLabelText("Tu zona"));
  });

  it("sigue mezclando su className con el del design system", () => {
    render(<Input aria-label="Tu zona" className="mt-2" />);

    const input = screen.getByLabelText("Tu zona");
    expect(input.className).toContain("mt-2");
    // La clase base compartida con Textarea/Select no se pierde.
    expect(input.className).toContain("rounded-md");
  });
});
