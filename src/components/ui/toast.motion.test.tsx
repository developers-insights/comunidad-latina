// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider, useToast } from "./toast";

/**
 * Integración con `motion/react` REAL: prueba que AnimatePresence desmonte el
 * nodo cuando el reloj lo descarta. Los demás casos viven en toast.test.tsx con
 * motion neutralizado (ahí se testea el reloj, no la animación).
 *
 * Timers REALES a propósito: el frameloop de motion corre sobre rAF y no avanza
 * con `vi.advanceTimersByTime` — bajo fake timers el nodo nunca sale del DOM
 * (verificado también contra un toast success, o sea: es el entorno, no el
 * componente). Por eso el aviso dura 50ms acá: la espera real es de ~200ms.
 */
function Trigger() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast({ title: "No se pudo comentar", variant: "danger", duration: 50 })
      }
    >
      disparar
    </button>
  );
}

describe("ToastCard + AnimatePresence real", () => {
  afterEach(cleanup);

  it("un danger se va del DOM solo, sin que nadie lo cierre", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "disparar" }));
    expect(screen.queryByText("No se pudo comentar")).not.toBeNull();

    await waitFor(() => expect(screen.queryByText("No se pudo comentar")).toBeNull(), {
      timeout: 3000,
    });
  });
});
