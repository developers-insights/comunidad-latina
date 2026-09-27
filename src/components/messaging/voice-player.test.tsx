// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { COPY_COMPOSER } from "./copy-composer";
import { PICOS_DE_ONDA } from "@/lib/messaging/audio";
import { BARRAS_DIBUJADAS, VoicePlayer, aBarras } from "./voice-player";

/**
 * LA ONDA QUE NO SE VEÍA.
 *
 * Las barras son `flex-1`: no tienen ancho propio, sólo los huecos entre ellas
 * lo tienen. Adentro de una burbuja —que mide lo que mide su contenido— eso
 * significaba que el ancho intrínseco del reproductor ERA la suma de los huecos,
 * y las 48 barras se repartían lo que sobraba: cero. Medido en el navegador,
 * `getBoundingClientRect().width === 0` en cada barra, en las dos burbujas.
 *
 * Los dos frenos que lo evitan viven acá porque los dos son fáciles de deshacer
 * sin querer: el número de barras y el ancho propio del reproductor.
 */

afterEach(cleanup);

describe("aBarras", () => {
  it("baja los picos guardados a las barras que se dibujan", () => {
    const guardados = Array.from({ length: PICOS_DE_ONDA }, (_, i) => i);
    expect(aBarras(guardados, BARRAS_DIBUJADAS)).toHaveLength(BARRAS_DIBUJADAS);
  });

  it("promedia la cubeta en vez de saltear picos", () => {
    // Con "una de cada dos", este arreglo daría [0, 0, 0]: los 100 desaparecen.
    expect(aBarras([0, 100, 0, 100, 0, 100], 3)).toEqual([50, 50, 50]);
  });

  it("deja pasar una onda que ya es más corta que el techo", () => {
    expect(aBarras([10, 20], BARRAS_DIBUJADAS)).toEqual([10, 20]);
  });
});

describe("VoicePlayer — la cadena de anchos", () => {
  function pintar(onda: number[]) {
    const { container } = render(
      <VoicePlayer src="/audio.webm" duracionMs={12_000} onda={onda} />,
    );
    return container.firstElementChild as HTMLElement;
  }

  it("dibuja BARRAS_DIBUJADAS barras por capa aunque la onda guardada traiga 48", () => {
    const raiz = pintar(Array.from({ length: PICOS_DE_ONDA }, () => 40));
    // Dos capas: la onda apagada y la misma recortada por el avance.
    expect(raiz.querySelectorAll("span.flex-1")).toHaveLength(BARRAS_DIBUJADAS * 2);
  });

  it("pide un ancho propio y acepta achicarse, en vez de un tope fijo", () => {
    const raiz = pintar([50, 50, 50]);
    const clases = raiz.className;
    // `max-w-xs` era un techo de 320 px que nunca llegaba a tocar: sin ancho
    // propio el reproductor medía lo que sumaban sus huecos.
    expect(clases).not.toContain("max-w-xs");
    expect(clases).toContain("max-w-full");
    expect(clases).toMatch(/\bw-\[/);
  });

  it("mantiene `cl-print-hide` (contrato de print-contract.test.ts)", () => {
    expect(pintar([50]).className).toContain("cl-print-hide");
  });
});

/**
 * «Una vez escuchado el audio no se puede volver a escuchar, se traba» (Nacho, 23/9).
 *
 * El hilo se refresca solo cada 15 s y cada refresco vuelve a firmar los
 * adjuntos: la URL del MISMO archivo cambia de token. Un <audio> al que le
 * cambian la `src` recarga, corta lo que sonaba y NO dispara `pause`
 * (el algoritmo de carga del estándar sólo rechaza las promesas pendientes),
 * así que el botón se quedaba en "Pausar" sobre un audio mudo, y tocarlo
 * llamaba a `pause()` sobre algo ya pausado: nada.
 */
describe("VoicePlayer — la firma que se renueva", () => {
  const firmada = (token: string) =>
    `https://x.supabase.co/storage/v1/object/sign/chat-media/t/c/nota.webm?token=${token}`;

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("pause"));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function audio(container: HTMLElement) {
    return container.querySelector("audio") as HTMLAudioElement;
  }

  it("una firma nueva del mismo archivo no recarga el audio", () => {
    const { container, rerender } = render(<VoicePlayer src={firmada("AAA")} duracionMs={9000} />);
    rerender(<VoicePlayer src={firmada("BBB")} duracionMs={9000} />);
    expect(audio(container).getAttribute("src")).toBe(firmada("AAA"));
  });

  it("otro archivo sí se carga", () => {
    const { container, rerender } = render(<VoicePlayer src={firmada("AAA")} duracionMs={9000} />);
    const otra = "https://x.supabase.co/storage/v1/object/sign/chat-media/t/c/otra.webm?token=CCC";
    rerender(<VoicePlayer src={otra} duracionMs={9000} />);
    expect(audio(container).getAttribute("src")).toBe(otra);
  });

  it("si la firma en uso venció, pasa a la nueva en vez de darlo por perdido", () => {
    const { container, rerender } = render(<VoicePlayer src={firmada("AAA")} duracionMs={9000} />);
    rerender(<VoicePlayer src={firmada("BBB")} duracionMs={9000} />);
    act(() => {
      audio(container).dispatchEvent(new Event("error"));
    });
    expect(audio(container).getAttribute("src")).toBe(firmada("BBB"));
    expect(screen.queryByText(COPY_COMPOSER.reproductor.noDisponible)).toBeNull();
  });

  it("una recarga del elemento devuelve el botón a Escuchar", () => {
    const { container } = render(<VoicePlayer src={firmada("AAA")} duracionMs={9000} />);
    fireEvent.click(screen.getByRole("button", { name: COPY_COMPOSER.reproductor.reproducir }));
    expect(screen.getByRole("button", { name: COPY_COMPOSER.reproductor.pausar })).toBeTruthy();
    act(() => {
      audio(container).dispatchEvent(new Event("emptied"));
    });
    expect(screen.getByRole("button", { name: COPY_COMPOSER.reproductor.reproducir })).toBeTruthy();
  });

  it("se vuelve a escuchar después de terminar", () => {
    const { container } = render(<VoicePlayer src={firmada("AAA")} duracionMs={9000} />);
    const play = HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
    fireEvent.click(screen.getByRole("button", { name: COPY_COMPOSER.reproductor.reproducir }));
    act(() => {
      audio(container).dispatchEvent(new Event("pause"));
      audio(container).dispatchEvent(new Event("ended"));
    });
    fireEvent.click(screen.getByRole("button", { name: COPY_COMPOSER.reproductor.reproducir }));
    expect(play).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: COPY_COMPOSER.reproductor.pausar })).toBeTruthy();
  });

  it("un play interrumpido no marca el audio como no disponible", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() =>
      Promise.reject(new DOMException("interrumpido", "AbortError")),
    );
    render(<VoicePlayer src={firmada("AAA")} duracionMs={9000} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: COPY_COMPOSER.reproductor.reproducir }));
    });
    expect(screen.queryByText(COPY_COMPOSER.reproductor.noDisponible)).toBeNull();
  });
});
