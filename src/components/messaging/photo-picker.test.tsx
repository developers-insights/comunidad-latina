// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const imagenLegible = vi.hoisted(() => vi.fn());
vi.mock("@/lib/media/imagen-legible", () => ({ imagenLegible }));

import { COPY_COMPOSER } from "./copy-composer";
import { PhotoPicker } from "./photo-picker";

const foto = (nombre: string) => new File(["x"], nombre, { type: "image/png" });

/** Los cuadros quedan en la cola: el test decide cuándo llegan. */
let cuadros: FrameRequestCallback[] = [];
const correrCuadros = () =>
  act(() => {
    cuadros.splice(0).forEach((cuadro) => cuadro(0));
  });

function elegir(chatId: string, archivo: File) {
  const onEnviar = vi.fn();
  render(<PhotoPicker open chatId={chatId} onClose={() => {}} onEnviar={onEnviar} />);
  const entrada = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!entrada) throw new Error("falta la entrada de archivos");
  fireEvent.change(entrada, { target: { files: [archivo] } });
  return onEnviar;
}

describe("PhotoPicker", () => {
  beforeEach(() => {
    cuadros = [];
    imagenLegible.mockResolvedValue(true);
    let n = 0;
    URL.createObjectURL = () => `blob:prueba/${++n}`;
    URL.revokeObjectURL = () => {};
    vi.stubGlobal("requestAnimationFrame", (cuadro: FrameRequestCallback) => {
      cuadros.push(cuadro);
      return cuadros.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("una foto elegida antes del primer cuadro se puede enviar igual", async () => {
    const archivo = foto("tarde.png");
    const onEnviar = elegir("chat-tarde", archivo);
    await screen.findByRole("button", { name: "tarde.png" });

    correrCuadros();

    fireEvent.click(await screen.findByRole("button", { name: COPY_COMPOSER.galeria.enviar }));
    expect(onEnviar).toHaveBeenCalledWith([archivo], "");
  });

  it("una imagen que no abre se avisa y no se puede enviar", async () => {
    imagenLegible.mockResolvedValue(false);
    elegir("chat-rota", foto("rota.png"));
    correrCuadros();

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toBe(COPY_COMPOSER.galeria.ilegible);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: COPY_COMPOSER.galeria.enviar })).toBeNull(),
    );
    expect(document.querySelector("img")).toBeNull();
  });
});
