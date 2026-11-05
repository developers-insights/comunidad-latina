import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imagenLegible } from "./imagen-legible";

class ImagenFalsa {
  static resultado: "carga" | "falla" | "vacia" = "carga";
  naturalWidth = ImagenFalsa.resultado === "carga" ? 800 : 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_url: string) {
    queueMicrotask(() =>
      ImagenFalsa.resultado === "falla" ? this.onerror?.() : this.onload?.(),
    );
  }
}

describe("imagenLegible", () => {
  const revocar = vi.fn();
  const archivo = new File(["x"], "foto.png", { type: "image/png" });

  beforeEach(() => {
    vi.stubGlobal("Image", ImagenFalsa);
    URL.createObjectURL = () => "blob:prueba";
    URL.revokeObjectURL = revocar;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    revocar.mockClear();
  });

  it.each([
    ["carga", true],
    ["falla", false],
    ["vacia", false],
  ] as const)("con una imagen que %s responde %s y suelta la URL", async (resultado, esperado) => {
    ImagenFalsa.resultado = resultado;
    await expect(imagenLegible(archivo)).resolves.toBe(esperado);
    expect(revocar).toHaveBeenCalledWith("blob:prueba");
  });
});
