// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast, type ToastOptions } from "./toast";

/**
 * `motion/react` corre sus animaciones con requestAnimationFrame y demora el
 * desmontaje real (AnimatePresence). Acá se testea el RELOJ del toast, no la
 * animación: neutralizamos motion para que el DOM refleje el estado al instante.
 */
/** Props exclusivas de motion que un <div> real no entiende. */
const MOTION_ONLY_PROPS = new Set(["layout", "initial", "animate", "exit", "transition"]);

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({
      children,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => {
      const domProps = Object.fromEntries(
        Object.entries(props).filter(([key]) => !MOTION_ONLY_PROPS.has(key)),
      );
      return <div {...domProps}>{children}</div>;
    },
  },
}));

function Trigger({ options }: { options: ToastOptions }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(options)}>
      disparar
    </button>
  );
}

function renderToast(options: ToastOptions) {
  render(
    <ToastProvider>
      <Trigger options={options} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "disparar" }));
}

/** Avanza los timers dentro de act() para que React aplique el re-render. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

const DANGER: ToastOptions = {
  title: "No se pudo comentar",
  description: "Algo no cargó bien de nuestro lado.",
  variant: "danger",
};

describe("ToastCard: auto-descarte", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("descarta un aviso danger a los 7s (antes era persistente)", async () => {
    renderToast(DANGER);
    expect(screen.getByText("No se pudo comentar")).toBeDefined();

    await advance(6_999);
    expect(screen.queryByText("No se pudo comentar")).not.toBeNull();

    await advance(2);
    expect(screen.queryByText("No se pudo comentar")).toBeNull();
  });

  it("usa 4.5s para las variantes no-danger", async () => {
    renderToast({ title: "Listo", variant: "success" });

    await advance(4_499);
    expect(screen.queryByText("Listo")).not.toBeNull();

    await advance(2);
    expect(screen.queryByText("Listo")).toBeNull();
  });

  it("respeta duration: 0 como persistente (escape hatch)", async () => {
    renderToast({ ...DANGER, duration: 0 });

    await advance(60_000);
    expect(screen.queryByText("No se pudo comentar")).not.toBeNull();
  });

  it("pausa el reloj mientras el mouse está encima", async () => {
    renderToast(DANGER);
    const card = screen.getByRole("alert");

    await advance(3_000); // quedan 4s
    fireEvent.mouseEnter(card);
    await advance(60_000); // el tiempo no corre con el mouse encima
    expect(screen.queryByText("No se pudo comentar")).not.toBeNull();
  });

  it("al salir el mouse retoma el tiempo RESTANTE, no reinicia el reloj", async () => {
    renderToast(DANGER);
    const card = screen.getByRole("alert");

    await advance(5_000); // consumidos 5s de 7s → quedan 2s
    fireEvent.mouseEnter(card);
    await advance(10_000); // pausado: no consume
    fireEvent.mouseLeave(card);

    // Si el reloj se hubiera reiniciado, a los 2s seguiría vivo.
    await advance(1_999);
    expect(screen.queryByText("No se pudo comentar")).not.toBeNull();
    await advance(2);
    expect(screen.queryByText("No se pudo comentar")).toBeNull();
  });

  it("pausa con el foco dentro (teclado / lector de pantalla)", async () => {
    renderToast(DANGER);

    await advance(3_000);
    fireEvent.focus(screen.getByRole("button", { name: "Cerrar aviso" }));
    await advance(60_000);
    expect(screen.queryByText("No se pudo comentar")).not.toBeNull();
  });
});
