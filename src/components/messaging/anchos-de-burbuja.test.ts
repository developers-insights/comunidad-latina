import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { esGestoDeCancelar } from "./voice-recorder";

/**
 * EL CONTRATO DE ANCHOS DE UNA BURBUJA, Y EL DE LOS ÍCONOS DEL GRABADOR.
 *
 * Se lee el fuente —como hace `src/test/print-contract.test.ts`— porque lo que
 * hay que anclar es CSS que jsdom no calcula: no hay layout, así que un render
 * nunca vería el desborde. Lo que sí se puede anclar es la cadena que lo
 * produce, que es de una sola pieza:
 *
 *   fila (`flex justify-*`) → envoltorio de MessageActions → burbuja `max-w-[%]`
 *
 * El envoltorio TIENE que ocupar el renglón entero. Cuando medía lo que medía su
 * contenido, el `max-w-[80%]` de la burbuja se resolvía contra un ancho que
 * dependía de la propia burbuja: la restricción se mordía la cola y caía en un
 * punto fijo —un audio medía 201 px igual a 320 que a 1440 de viewport—.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const leer = (archivo: string) => readFileSync(join(AQUI, archivo), "utf8");

describe("la cadena de anchos de la burbuja", () => {
  it("el envoltorio de MessageActions ocupa el renglón y alinea él mismo", () => {
    const fuente = leer("message-menu.tsx");
    expect(fuente).toContain('"flex w-full min-w-0 items-end gap-1"');
    expect(fuente).toContain('isOwn ? "justify-end" : "justify-start"');
  });

  it("las dos burbujas siguen topando contra un porcentaje del renglón", () => {
    expect(leer("message-bubble.tsx")).toContain("max-w-[80%]");
    expect(leer("group-message-bubble.tsx")).toContain("max-w-[78%]");
  });

  it("ningún adjunto del hilo trae un ancho máximo fijo propio", () => {
    // `max-w-xs` en el reproductor era el único freno real del audio, y no
    // tenía relación con el ancho del renglón.
    for (const archivo of ["voice-player.tsx", "message-attachment.tsx"]) {
      expect(leer(archivo)).not.toMatch(/max-w-(xs|sm|md|lg|xl|\[\d+px\])/);
    }
  });
});

describe("el grabador: un avión, una sola acción", () => {
  it("el único PaperPlaneRight del grabador es el de enviar", () => {
    const fuente = leer("voice-recorder.tsx");
    const aviones = fuente.match(/<PaperPlaneRight/g) ?? [];
    // El de manos libres TERMINA la grabación y abre la vista previa: no manda
    // nada. Con el mismo ícono y el mismo `bg-brand` que el de enviar, la gente
    // tocaba, veía cambiar la barra y daba el audio por enviado.
    expect(aviones).toHaveLength(1);
    expect(fuente).toContain("<Stop size={19}");
  });
});

describe("esGestoDeCancelar", () => {
  it("cancela con un arrastre claramente horizontal", () => {
    expect(esGestoDeCancelar(-120, -10)).toBe(true);
  });

  it("no cancela antes del umbral", () => {
    expect(esGestoDeCancelar(-40, 0)).toBe(false);
  });

  it("no cancela una diagonal que iba a manos libres", () => {
    // Pasó los 80 px de cancelar, pero el dedo subía más de lo que iba a la
    // izquierda: eso es alguien buscando el candado, no tirando la nota.
    expect(esGestoDeCancelar(-90, -140)).toBe(false);
  });
});
