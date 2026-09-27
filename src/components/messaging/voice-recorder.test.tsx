// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { COPY_COMPOSER } from "./copy-composer";
import { VoiceRecorder } from "./voice-recorder";

/**
 * «Falta poder enviar el audio, no hay botón todavía» (Nacho, 22/9).
 *
 * Se prueba el grabador con un MediaRecorder falso porque lo que se rompió no
 * era la grabación sino el camino hasta `onListo`: soltar abría una vista
 * previa, manos libres no tenía botón de enviar, y el botón que recibía el
 * dedo se desmontaba al empezar a grabar.
 */

class RecorderFalso {
  static isTypeSupported = () => true;
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((evento: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
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
  vi.useRealTimers();
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
    fireEvent.pointerDown(nodo, { pointerId: 1, clientX: 0, clientY: 0 });
  });
}

async function soltar() {
  await act(async () => {
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
  });
}

async function hastaQue(condicion: () => boolean) {
  for (let i = 0; i < 50 && !condicion(); i += 1) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 5));
    });
  }
}

describe("VoiceRecorder — enviar", () => {
  it("el botón que recibe el dedo es el mismo nodo mientras graba", async () => {
    render(<VoiceRecorder onListo={() => {}} />);
    const antes = boton();
    await apoyar(antes);
    await hastaQue(() => screen.queryByRole("timer") !== null);
    expect(screen.getByRole("timer")).toBeTruthy();
    expect(boton()).toBe(antes);
  });

  it("sostener y soltar manda la nota sin pasar por la vista previa", async () => {
    const onListo = vi.fn();
    render(<VoiceRecorder onListo={onListo} />);
    const nodo = boton();
    await apoyar(nodo);
    await hastaQue(() => screen.queryByRole("timer") !== null);
    // Más que un toque: es un sostenido.
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 450));
    });
    await soltar();
    await hastaQue(() => onListo.mock.calls.length > 0);
    expect(onListo).toHaveBeenCalledTimes(1);
    expect(onListo.mock.calls[0][0].blob).toBeInstanceOf(Blob);
    expect(screen.queryByText(COPY_COMPOSER.voz.vistaPrevia)).toBeNull();
  });

  it("un toque entra a manos libres sin mandar, y el avión manda", async () => {
    const onListo = vi.fn();
    render(<VoiceRecorder onListo={onListo} />);
    const nodo = boton();
    await apoyar(nodo);
    await hastaQue(() => screen.queryByRole("timer") !== null);
    await soltar();
    // El click que cierra ESE mismo toque no puede mandar nada.
    await act(async () => {
      fireEvent.click(nodo, { detail: 1 });
    });
    expect(screen.getByText(COPY_COMPOSER.voz.bloqueada)).toBeTruthy();
    expect(onListo).not.toHaveBeenCalled();

    const enviar = screen.getByRole("button", { name: COPY_COMPOSER.voz.enviar });
    expect(enviar).toBe(nodo);
    await act(async () => {
      fireEvent.pointerDown(enviar, { pointerId: 2 });
      fireEvent.click(enviar, { detail: 1 });
    });
    await hastaQue(() => onListo.mock.calls.length > 0);
    expect(onListo).toHaveBeenCalledTimes(1);
  });

  /**
   * «Si apreto una vez en el celular no se puede enviar el audio» (Nacho, 23/9).
   * En el teléfono `getUserMedia` tarda más que un toque —y la primera vez hay
   * un cartel de permiso en el medio—, así que el dedo se levanta con la fase
   * todavía en `pidiendo`. Los tests de arriba esperan el micrófono ANTES de
   * soltar, que es justo lo que en un teléfono no pasa.
   */
  function microfonoQueTarda() {
    const pendiente: { dar: (valor: unknown) => void } = { dar: () => {} };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise((resolver) => {
              pendiente.dar = resolver;
            }),
        ),
      },
    });
    return pendiente;
  }

  it("un toque que termina antes de que llegue el micrófono entra a manos libres", async () => {
    const microfono = microfonoQueTarda();
    const onListo = vi.fn();
    render(<VoiceRecorder onListo={onListo} />);
    const nodo = boton();
    await apoyar(nodo);
    await soltar();
    await act(async () => {
      fireEvent.click(nodo, { detail: 1 });
    });
    await act(async () => {
      microfono.dar({ getTracks: () => [{ stop() {} }] });
    });
    await hastaQue(() => screen.queryByRole("timer") !== null);
    expect(screen.getByText(COPY_COMPOSER.voz.bloqueada)).toBeTruthy();
    expect(onListo).not.toHaveBeenCalled();

    const enviar = screen.getByRole("button", { name: COPY_COMPOSER.voz.enviar });
    await act(async () => {
      fireEvent.pointerDown(enviar, { pointerId: 2 });
      fireEvent.click(enviar, { detail: 1 });
    });
    await hastaQue(() => onListo.mock.calls.length > 0);
    expect(onListo).toHaveBeenCalledTimes(1);
  });

  it("sostener y soltar mientras el navegador pregunta no graba nada", async () => {
    const microfono = microfonoQueTarda();
    const parar = vi.fn();
    render(<VoiceRecorder onListo={() => {}} />);
    await apoyar(boton());
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 450));
    });
    await soltar();
    await act(async () => {
      microfono.dar({ getTracks: () => [{ stop: parar }] });
    });
    expect(screen.queryByRole("timer")).toBeNull();
    expect(parar).toHaveBeenCalled();
  });

  it("en manos libres, el cuadrado abre la vista previa y no manda", async () => {
    const onListo = vi.fn();
    render(<VoiceRecorder onListo={onListo} />);
    await apoyar(boton());
    await hastaQue(() => screen.queryByRole("timer") !== null);
    await soltar();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: COPY_COMPOSER.voz.detener }));
    });
    await hastaQue(() => screen.queryByText(COPY_COMPOSER.voz.vistaPrevia) !== null);
    expect(screen.getByText(COPY_COMPOSER.voz.vistaPrevia)).toBeTruthy();
    expect(onListo).not.toHaveBeenCalled();
  });
});
