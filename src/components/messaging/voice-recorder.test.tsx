// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { COPY_COMPOSER } from "./copy-composer";
import { VoiceRecorder } from "./voice-recorder";

class RecorderFalso {
  static isTypeSupported = () => true;
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((evento: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", RecorderFalso);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function boton() {
  return screen.getByRole("button", {
    name: new RegExp(
      [COPY_COMPOSER.voz.grabar, COPY_COMPOSER.voz.soltarEnviar, COPY_COMPOSER.voz.enviar]
        .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|"),
    ),
  });
}

async function apoyar(nodo: HTMLElement) {
  await act(async () => {
    fireEvent.pointerDown(nodo, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
  });
}

async function mover(clientX: number) {
  await act(async () => {
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX, clientY: 0 }));
  });
}

async function soltar(tipo: "pointerup" | "pointercancel" = "pointerup") {
  await act(async () => {
    window.dispatchEvent(new PointerEvent(tipo, { pointerId: 1 }));
  });
}

async function esperar(ms: number) {
  await act(async () => {
    await new Promise((resolver) => setTimeout(resolver, ms));
  });
}

async function hastaQue(condicion: () => boolean) {
  for (let i = 0; i < 80 && !condicion(); i += 1) await esperar(5);
}

async function grabarSosteniendo(onListo = vi.fn(), onActivo?: (activo: boolean) => void) {
  const vista = render(<VoiceRecorder onListo={onListo} onActivo={onActivo} />);
  const nodo = boton();
  await apoyar(nodo);
  await hastaQue(() => screen.queryByRole("timer") !== null);
  return { nodo, onListo, vista };
}

describe("VoiceRecorder — mantener apretado", () => {
  it("el botón que recibe el dedo es el mismo nodo mientras graba", async () => {
    const { nodo } = await grabarSosteniendo();
    expect(screen.getByRole("timer")).toBeTruthy();
    expect(boton()).toBe(nodo);
  });

  it("soltar después de medio segundo manda la nota", async () => {
    const { onListo } = await grabarSosteniendo();
    await esperar(600);
    await soltar();
    await hastaQue(() => onListo.mock.calls.length > 0);
    expect(onListo).toHaveBeenCalledTimes(1);
    expect(onListo.mock.calls[0][0].blob).toBeInstanceOf(Blob);
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("deslizar a la izquierda pasado el umbral cancela sin soltar y no manda nada", async () => {
    const { onListo } = await grabarSosteniendo();
    await esperar(600);
    await mover(-40);
    expect(screen.getByText(COPY_COMPOSER.voz.deslizarCancelar)).toBeTruthy();
    expect(screen.queryByText(COPY_COMPOSER.voz.cancelada)).toBeNull();
    await mover(-160);
    expect(screen.getByText(COPY_COMPOSER.voz.cancelada)).toBeTruthy();
    await soltar();
    await esperar(50);
    expect(onListo).not.toHaveBeenCalled();
    await hastaQue(() => screen.queryByText(COPY_COMPOSER.voz.cancelada) === null);
    expect(screen.getByRole("button", { name: COPY_COMPOSER.voz.grabar })).toBeTruthy();
  });

  it("mientras graba, la barra no tiene otros botones: ni manos libres, ni pausa, ni cuadrado", async () => {
    const onActivo = vi.fn();
    const { vista } = await grabarSosteniendo(vi.fn(), onActivo);
    expect(onActivo).toHaveBeenLastCalledWith(true);
    expect(within(vista.container).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: COPY_COMPOSER.voz.eliminar })).toBeNull();
  });

  it("una grabación de menos de medio segundo se descarta y avisa cómo grabar", async () => {
    const { onListo } = await grabarSosteniendo();
    await soltar();
    await esperar(50);
    expect(onListo).not.toHaveBeenCalled();
    expect(screen.getByText(COPY_COMPOSER.voz.mantener)).toBeTruthy();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("si el sistema se roba el gesto (pointercancel), la nota no sale", async () => {
    const { onListo } = await grabarSosteniendo();
    await esperar(600);
    await soltar("pointercancel");
    await esperar(50);
    expect(onListo).not.toHaveBeenCalled();
  });

  it("siempre libera el micrófono al terminar", async () => {
    const parar = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: parar }] })) },
    });
    await grabarSosteniendo();
    await esperar(600);
    await soltar();
    await hastaQue(() => parar.mock.calls.length > 0);
    expect(parar).toHaveBeenCalled();
  });
});

describe("VoiceRecorder — micrófono que tarda", () => {
  function microfonoQueTarda(parar: () => void = () => {}) {
    const pendiente = { dar: () => {} };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise((resolver) => {
              pendiente.dar = () => resolver({ getTracks: () => [{ stop: parar }] });
            }),
        ),
      },
    });
    return pendiente;
  }

  it("un toque que termina antes de que llegue el micrófono no graba y avisa", async () => {
    const parar = vi.fn();
    const microfono = microfonoQueTarda(parar);
    const onListo = vi.fn();
    render(<VoiceRecorder onListo={onListo} />);
    await apoyar(boton());
    await soltar();
    await act(async () => microfono.dar());
    expect(screen.queryByRole("timer")).toBeNull();
    expect(parar).toHaveBeenCalled();
    expect(screen.getByText(COPY_COMPOSER.voz.mantener)).toBeTruthy();
    expect(onListo).not.toHaveBeenCalled();
  });

  it("sostener y soltar mientras el navegador pregunta no graba nada", async () => {
    const parar = vi.fn();
    const microfono = microfonoQueTarda(parar);
    render(<VoiceRecorder onListo={() => {}} />);
    await apoyar(boton());
    await esperar(600);
    await soltar();
    await act(async () => microfono.dar());
    expect(screen.queryByRole("timer")).toBeNull();
    expect(parar).toHaveBeenCalled();
  });
});

describe("VoiceRecorder — teclado y lector de pantalla", () => {
  it("Enter graba, el mismo botón manda", async () => {
    const onListo = vi.fn();
    render(<VoiceRecorder onListo={onListo} />);
    const nodo = boton();
    await act(async () => {
      fireEvent.click(nodo, { detail: 0 });
    });
    await hastaQue(() => screen.queryByRole("timer") !== null);
    expect(screen.getByText(COPY_COMPOSER.voz.grabandoTeclado)).toBeTruthy();
    expect(screen.getByRole("button", { name: COPY_COMPOSER.voz.eliminar })).toBeTruthy();
    const enviar = screen.getByRole("button", { name: COPY_COMPOSER.voz.enviar });
    expect(enviar).toBe(nodo);
    await act(async () => {
      fireEvent.click(enviar, { detail: 0 });
    });
    await hastaQue(() => onListo.mock.calls.length > 0);
    expect(onListo).toHaveBeenCalledTimes(1);
  });

  it("Escape cancela y no manda", async () => {
    const onListo = vi.fn();
    render(<VoiceRecorder onListo={onListo} />);
    const nodo = boton();
    await act(async () => {
      fireEvent.click(nodo, { detail: 0 });
    });
    await hastaQue(() => screen.queryByRole("timer") !== null);
    await act(async () => {
      fireEvent.keyDown(nodo, { key: "Escape" });
    });
    await esperar(50);
    expect(onListo).not.toHaveBeenCalled();
    expect(screen.getByText(COPY_COMPOSER.voz.cancelada)).toBeTruthy();
  });

  it("el tachito cancela", async () => {
    const onListo = vi.fn();
    render(<VoiceRecorder onListo={onListo} />);
    await act(async () => {
      fireEvent.click(boton(), { detail: 0 });
    });
    await hastaQue(() => screen.queryByRole("timer") !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: COPY_COMPOSER.voz.eliminar }));
    });
    await esperar(50);
    expect(onListo).not.toHaveBeenCalled();
  });

  it("el click que cierra un toque con el dedo no arranca el modo teclado", async () => {
    const { nodo } = await grabarSosteniendo();
    await soltar();
    await act(async () => {
      fireEvent.click(nodo, { detail: 1 });
    });
    await esperar(50);
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByText(COPY_COMPOSER.voz.grabandoTeclado)).toBeNull();
  });
});
