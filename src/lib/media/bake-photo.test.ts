// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bakePhoto, JPEG_QUALITY, MAX_LONG_SIDE } from "./bake-photo";

/**
 * jsdom no trae un canvas de verdad (`getContext` devuelve `null` sin el
 * paquete `canvas`, que este repo no instala) ni decodifica imágenes reales.
 * Estos tests stubean el PISO del navegador —bitmap ya decodificado +
 * contexto 2D— y verifican la lógica propia de `bake-photo.ts` contra esos
 * stubs: escalado, calidad, filtro, texto y sobre todo el contrato de
 * fallback ("nunca bloquees la publicación por un efecto decorativo"). Lo
 * que NO se testea acá es el resultado visual real — eso necesita un
 * navegador de verdad.
 */

function makeFile(name = "foto.jpg", type = "image/jpeg"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

interface FakeCtx {
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillStyle: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
  filter?: string;
}

function makeCtx(supportsFilter: boolean): FakeCtx {
  const ctx: FakeCtx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillStyle: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
  };
  if (supportsFilter) ctx.filter = "none";
  return ctx;
}

let currentCtx: FakeCtx;
let toBlobResult: Blob | null = new Blob(["contenido"], { type: "image/jpeg" });

function stubBitmap(width: number, height: number) {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width, height, close: vi.fn() })),
  );
}

beforeEach(() => {
  currentCtx = makeCtx(true);
  toBlobResult = new Blob(["contenido"], { type: "image/jpeg" });
  stubBitmap(3200, 2400);

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => currentCtx as unknown as RenderingContext,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
  ) {
    callback(toBlobResult);
  });
  // Silenciamos el console.error esperado en los tests de fallback — no es
  // ruido, es justamente lo que bake-photo.ts promete loguear (nunca un
  // catch {} mudo), pero acá lo estamos provocando a propósito.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bakePhoto — redimensiona sin agrandar", () => {
  it("baja el lado largo a MAX_LONG_SIDE cuando la foto es más grande", async () => {
    await bakePhoto(makeFile());
    const expectedHeight = Math.round(2400 * (MAX_LONG_SIDE / 3200));
    expect(currentCtx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      MAX_LONG_SIDE,
      expectedHeight,
    );
  });

  it("NUNCA agranda una foto más chica que el tope", async () => {
    stubBitmap(800, 1000);
    await bakePhoto(makeFile());
    expect(currentCtx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 1000);
  });

  it("respeta un maxLongSide custom", async () => {
    await bakePhoto(makeFile(), { maxLongSide: 800 });
    expect(currentCtx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600);
  });
});

describe("bakePhoto — calidad y formato: SIEMPRE JPEG, se haya tocado el filtro o no", () => {
  it("usa la calidad default", async () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    await bakePhoto(makeFile());
    expect(spy).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", JPEG_QUALITY);
  });

  it("respeta una calidad custom", async () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    await bakePhoto(makeFile(), { quality: 0.6 });
    expect(spy).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.6);
  });

  it("el archivo resultante siempre termina en .jpg, sea cual sea el original", async () => {
    const result = await bakePhoto(makeFile("vacaciones.png", "image/png"));
    expect(result.name).toBe("vacaciones.jpg");
    expect(result.type).toBe("image/jpeg");
  });
});

describe("bakePhoto — filtro", () => {
  it("aplica el filtro pedido cuando el navegador lo soporta", async () => {
    await bakePhoto(makeFile(), { filterCss: "grayscale(1)" });
    // Se captura el valor de `ctx.filter` en el momento de dibujar: el
    // código lo resetea a "none" después, para no filtrar el texto también.
    expect(currentCtx.drawImage).toHaveBeenCalled();
  });

  it("sin filtro pedido, hornea igual aunque el navegador no soporte ctx.filter", async () => {
    currentCtx = makeCtx(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => currentCtx as unknown as RenderingContext,
    );
    const onFallback = vi.fn();
    const result = await bakePhoto(makeFile(), { onFallback });
    expect(onFallback).not.toHaveBeenCalled();
    expect(result.type).toBe("image/jpeg");
  });

  it("si se pidió un filtro y el navegador NO lo soporta, devuelve el original y avisa", async () => {
    currentCtx = makeCtx(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => currentCtx as unknown as RenderingContext,
    );
    const original = makeFile("original.jpg");
    const onFallback = vi.fn();

    const result = await bakePhoto(original, { filterCss: "sepia(1)", onFallback });

    expect(result).toBe(original);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0]?.[0]).toMatch(/filtro/i);
    // Nunca llegó a dibujar nada: se cortó ANTES, no "a medias".
    expect(currentCtx.drawImage).not.toHaveBeenCalled();
  });
});

describe("bakePhoto — nunca bloquea la publicación", () => {
  it("si canvas.toBlob devuelve null, cae al archivo original y avisa", async () => {
    toBlobResult = null;
    const original = makeFile("intacta.jpg");
    const onFallback = vi.fn();

    const result = await bakePhoto(original, { onFallback });

    expect(result).toBe(original);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("si getContext devuelve null (canvas no disponible), cae al original y avisa", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    const original = makeFile("sin-canvas.jpg");
    const onFallback = vi.fn();

    const result = await bakePhoto(original, { onFallback });

    expect(result).toBe(original);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("sin onFallback, no explota: simplemente no avisa a nadie", async () => {
    toBlobResult = null;
    const original = makeFile();
    await expect(bakePhoto(original)).resolves.toBe(original);
  });
});

describe("bakePhoto — texto sobre la foto", () => {
  it("sin caption, no dibuja texto", async () => {
    await bakePhoto(makeFile());
    expect(currentCtx.fillText).not.toHaveBeenCalled();
    expect(currentCtx.fillRect).not.toHaveBeenCalled();
  });

  it("con caption, dibuja el texto", async () => {
    await bakePhoto(makeFile(), {
      caption: { text: "Se vende", position: "bottom", background: "solid" },
    });
    expect(currentCtx.fillText).toHaveBeenCalled();
  });

  it("fondo 'solid' pinta una barra ANTES del texto", async () => {
    await bakePhoto(makeFile(), {
      caption: { text: "Casa en venta", position: "top", background: "solid" },
    });
    expect(currentCtx.fillRect).toHaveBeenCalledTimes(1);
    expect(currentCtx.fillText).toHaveBeenCalled();
  });

  it("fondo 'none' NO pinta barra — la legibilidad la da la sombra", async () => {
    await bakePhoto(makeFile(), {
      caption: { text: "Casa en venta", position: "center", background: "none" },
    });
    expect(currentCtx.fillRect).not.toHaveBeenCalled();
    expect(currentCtx.fillText).toHaveBeenCalled();
  });

  it("un caption de puros espacios no dibuja nada (mismo criterio que el trim al guardar)", async () => {
    await bakePhoto(makeFile(), {
      caption: { text: "   ", position: "bottom", background: "solid" },
    });
    expect(currentCtx.fillText).not.toHaveBeenCalled();
  });
});
