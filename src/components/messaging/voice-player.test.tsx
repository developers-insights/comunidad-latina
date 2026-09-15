// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
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
