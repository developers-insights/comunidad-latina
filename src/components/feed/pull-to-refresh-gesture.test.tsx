// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { PullToRefresh } from "./pull-to-refresh";

/**
 * `touchmove` nativo dispara decenas de veces por segundo; antes cada uno
 * llamaba `setPull` directo, re-renderizando el indicador (`height`, que
 * fuerza reflow) una vez por evento. Ahora se agrupan en un solo
 * `requestAnimationFrame` por frame — acá se ancla ESE comportamiento
 * (una sola muestra pedida por frame, con el valor más reciente) y que un
 * frame pendiente no sobrevive al desmontaje de la card.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

afterEach(cleanup);

/** El div con los listeners táctiles es la raíz que monta PullToRefresh. */
function mount() {
  const { container, unmount } = render(
    <PullToRefresh>
      <div>contenido del feed</div>
    </PullToRefresh>,
  );
  const root = container.firstElementChild as HTMLElement;
  const indicator = root.firstElementChild as HTMLElement;
  return { root, indicator, unmount };
}

describe("PullToRefresh: setPull agrupado por frame", () => {
  it("varias muestras de touchmove en el mismo frame piden un solo requestAnimationFrame", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");
    const { root } = mount();

    fireEvent.touchStart(root, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(root, { touches: [{ clientY: 130 }] });
    fireEvent.touchMove(root, { touches: [{ clientY: 150 }] });
    fireEvent.touchMove(root, { touches: [{ clientY: 170 }] });

    // Tres touchmove, UN solo frame pedido: se coalescen.
    expect(rafSpy).toHaveBeenCalledTimes(1);

    rafSpy.mockRestore();
  });

  it("al correr el frame, el indicador refleja la ÚLTIMA muestra del gesto, no una intermedia", () => {
    vi.useFakeTimers();
    const { root, indicator } = mount();

    fireEvent.touchStart(root, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(root, { touches: [{ clientY: 130 }] }); // dampPull(30) = 15
    fireEvent.touchMove(root, { touches: [{ clientY: 150 }] }); // dampPull(50) = 25
    fireEvent.touchMove(root, { touches: [{ clientY: 170 }] }); // dampPull(70) = 35

    // Antes de que corra el frame, el indicador todavía no se movió.
    expect(indicator.style.height).toBe("0px");

    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(indicator.style.height).toBe("35px");

    vi.useRealTimers();
  });

  it("una nueva muestra después de flushear pide un frame nuevo (no se queda pegado)", () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");
    const { root } = mount();

    fireEvent.touchStart(root, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(root, { touches: [{ clientY: 130 }] });
    expect(rafSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(20);
    });

    fireEvent.touchMove(root, { touches: [{ clientY: 160 }] });
    expect(rafSpy).toHaveBeenCalledTimes(2);

    rafSpy.mockRestore();
    vi.useRealTimers();
  });

  it("desmontar a mitad de gesto cancela el frame pendiente en vez de dejarlo correr sobre un componente muerto", () => {
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");
    const { root, unmount } = mount();

    fireEvent.touchStart(root, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(root, { touches: [{ clientY: 140 }] }); // pide un frame

    expect(() => unmount()).not.toThrow();
    expect(cancelSpy).toHaveBeenCalled();

    cancelSpy.mockRestore();
  });
});
