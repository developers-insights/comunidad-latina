// @vitest-environment jsdom
import type { ComponentProps, ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BottomSheet } from "./bottom-sheet";

/**
 * =============================================================================
 * EL ARRASTRE DE LA HOJA, Y CUÁNDO NO TIENE QUE EXISTIR
 * =============================================================================
 *
 * Origen (feedback cliente 2026-09-03, punto 1 — video real de un iPhone): el
 * editor de fotos vive DENTRO de esta hoja. En el teléfono, el mismo gesto que
 * movía un emoji o paneaba el recorte arrastraba el panel entero y al soltar la
 * hoja se cerraba: "si lo mueves un poquitico, boom, se regresa al paso uno".
 *
 * La causa no era el editor. `touch-action: none` y `setPointerCapture` frenan
 * el scroll del navegador, pero no al gesto del padre: framer-motion escucha el
 * `pointerdown` en el panel y el arrastre arranca igual. En una compu no se
 * notaba porque ahí el gesto es otro.
 *
 * Lo que se ancla acá es la salida: mientras alguien está EDITANDO adentro, la
 * hoja no se arrastra — y todas las demás formas de salir siguen intactas.
 *
 * ── POR QUÉ EL MOCK ESPÍA LAS PROPS DEL PANEL ───────────────────────────────
 * Bajo jsdom no hay gesto real que simular: framer-motion está neutralizado (si
 * no lo estuviera, el panel se montaría en `opacity: 0` y no habría nada que
 * mirar). Lo que sí se puede reproducir con fidelidad es SU CONTRATO, que es de
 * una línea: `onDragEnd` sólo puede llegar si el gesto está armado. Con
 * `drag={false}` framer-motion 12 ni monta la feature — su `isEnabled` mira
 * `drag` y `dragControls` y nada más (`motion/features/definitions.mjs`). Eso
 * es exactamente lo que hace `arrastrarPanel`, y por eso el test falla de
 * verdad cuando el arrastre sigue armado.
 */

type PanInfo = { offset: { x: number; y: number }; velocity: { x: number; y: number } };
type PanelProps = Record<string, unknown> & {
  drag?: unknown;
  onDragEnd?: (event: unknown, info: PanInfo) => void;
};

const espia = vi.hoisted(() => ({ panel: null as PanelProps | null }));

vi.mock("motion/react", async () => {
  const { createElement } = await import("react");
  const { motionMock } = await import("@/test/motion-mock");
  // Animación PRENDIDA a propósito: con `useReducedMotion()` en true el
  // arrastre ya estaría apagado y estos tests no probarían nada.
  const base = motionMock({ reducedMotion: false });
  const componentes = base.m as unknown as Record<string, ComponentType<PanelProps>>;
  const cache: Record<string, ComponentType<PanelProps>> = {};
  const porTag = new Proxy({} as Record<string, ComponentType<PanelProps>>, {
    get(_destino, clave) {
      if (typeof clave !== "string" || clave === "then") return undefined;
      cache[clave] ??= (props: PanelProps) => {
        // El panel es el `role="dialog"`; el otro `m.div` de la hoja es el velo.
        if (props.role === "dialog") espia.panel = props;
        return createElement(componentes[clave], props);
      };
      return cache[clave];
    },
  });
  return { ...base, m: porTag, motion: porTag };
});

afterEach(() => {
  cleanup();
  espia.panel = null;
});

function abrir(over: Partial<ComponentProps<typeof BottomSheet>> = {}) {
  const onClose = vi.fn();
  render(
    <BottomSheet open onClose={onClose} title="Editar la foto" {...over}>
      <button type="button">Adentro</button>
    </BottomSheet>,
  );
  return { onClose };
}

/** Un arrastre del panel que termina. Ver el docblock de arriba. */
function arrastrarPanel(offsetY: number, velocityY = 0): void {
  const panel = espia.panel;
  // Sin gesto armado no hay arrastre que terminar: es lo que hace el navegador.
  if (!panel?.drag) return;
  panel.onDragEnd?.(new MouseEvent("mouseup"), {
    offset: { x: 0, y: offsetY },
    velocity: { x: 0, y: velocityY },
  });
}

const velo = () => document.querySelector<HTMLElement>(".bg-scrim");

describe("BottomSheet: el arrastre para descartar", () => {
  it("sin bloquear, deslizar el panel hacia abajo cierra la hoja", () => {
    // Guarda del test de abajo: si esto dejara de pasar, "no cierra" no
    // significaría nada.
    const { onClose } = abrir();
    arrastrarPanel(120);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("un tirón corto pero rápido también cierra (velocidad, no sólo distancia)", () => {
    const { onClose } = abrir();
    arrastrarPanel(20, 900);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("un roce hacia abajo no alcanza", () => {
    const { onClose } = abrir();
    arrastrarPanel(30);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("BottomSheet: con los gestos bloqueados (editor abierto adentro)", () => {
  it("el mismo arrastre hacia abajo NO cierra nada", () => {
    const { onClose } = abrir({ gesturesLocked: true });
    arrastrarPanel(240, 1200);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("el gesto ni siquiera se arma: framer-motion no monta el arrastre", () => {
    // La diferencia importa: un `onDragEnd` que decide no cerrar seguiría
    // MOVIENDO el panel debajo del dedo mientras se acomoda un emoji.
    abrir({ gesturesLocked: true });
    expect(espia.panel?.drag).toBe(false);
  });

  it("Escape sigue cerrando", () => {
    const { onClose } = abrir({ gesturesLocked: true });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("el velo sigue cerrando", () => {
    const { onClose } = abrir({ gesturesLocked: true });
    const scrim = velo();
    expect(scrim).toBeTruthy();
    fireEvent.click(scrim as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("el handle deja de decir 'deslizable': sin cursor de agarre", () => {
    // Un asa que invita a un gesto que no existe es una promesa incumplida.
    abrir({ gesturesLocked: true });
    const handle = document.querySelector<HTMLElement>(".bg-border");
    expect(handle?.className).not.toContain("cursor-grab");
  });

  it("el contenido de adentro se sigue viendo y se sigue tocando", () => {
    abrir({ gesturesLocked: true });
    expect(screen.getByRole("button", { name: "Adentro" })).toBeTruthy();
  });
});

describe("BottomSheet: lo que ya funcionaba no cambia", () => {
  it("sin bloquear, el handle sigue invitando al arrastre", () => {
    abrir();
    const handle = document.querySelector<HTMLElement>(".bg-border");
    expect(handle?.className).toContain("cursor-grab");
  });

  it("cerrada no monta nada", () => {
    abrir({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
