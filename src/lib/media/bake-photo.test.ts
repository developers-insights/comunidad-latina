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

/**
 * NOTA SOBRE LA FORMA DE `drawImage`. Desde que el editor recorta, el horneado
 * usa siempre la versión de NUEVE argumentos (rectángulo de fuente + destino):
 * sin recorte el rectángulo de fuente es la imagen completa y el resultado es
 * idéntico al de la versión de cinco. Se usa una sola forma a propósito — dos
 * caminos de dibujo son dos formas de que el recorte se aplique en uno y no en
 * el otro.
 */
function drawArgs(): unknown[] {
  const call = currentCtx.drawImage.mock.calls.at(-1);
  if (!call) throw new Error("no se llamó a drawImage");
  return call as unknown[];
}

describe("bakePhoto — redimensiona sin agrandar", () => {
  it("baja el lado largo a MAX_LONG_SIDE cuando la foto es más grande", async () => {
    await bakePhoto(makeFile());
    const expectedHeight = Math.round(2400 * (MAX_LONG_SIDE / 3200));
    expect(drawArgs().slice(1)).toEqual([0, 0, 3200, 2400, 0, 0, MAX_LONG_SIDE, expectedHeight]);
  });

  it("NUNCA agranda una foto más chica que el tope", async () => {
    stubBitmap(800, 1000);
    await bakePhoto(makeFile());
    expect(drawArgs().slice(1)).toEqual([0, 0, 800, 1000, 0, 0, 800, 1000]);
  });

  it("respeta un maxLongSide custom", async () => {
    await bakePhoto(makeFile(), { maxLongSide: 800 });
    expect(drawArgs().slice(1)).toEqual([0, 0, 3200, 2400, 0, 0, 800, 600]);
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

/* ==========================================================================
 * RECORTE, EMOJIS Y ESTILO DEL TEXTO (2026-08-26)
 * ==========================================================================
 *
 * Lo nuevo del editor tiene que QUEMARSE igual que el filtro y el texto: si se
 * ve en la vista previa y no llega al archivo, la persona publica algo distinto
 * de lo que aprobó — y el horneado no se puede deshacer.
 */

import {
  DEFAULT_STICKER_SIZE,
  resolveCaptionColor,
  type PhotoSticker,
} from "./photo-overlay";
import { FULL_CROP } from "./photo-crop";

function sticker(over: Partial<PhotoSticker> = {}): PhotoSticker {
  return { id: "s1", emoji: "🔥", x: 0.5, y: 0.5, size: DEFAULT_STICKER_SIZE, ...over };
}

describe("bakePhoto — el recorte se quema en los píxeles", () => {
  it("sin recorte dibuja la imagen entera (mismo resultado que antes del recorte)", async () => {
    await bakePhoto(makeFile(), { crop: FULL_CROP });
    expect(drawArgs().slice(1, 5)).toEqual([0, 0, 3200, 2400]);
  });

  it("un recorte central toma SOLO esa porción de la fuente", async () => {
    // La mitad central de una foto de 3200×2400.
    await bakePhoto(makeFile(), { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
    expect(drawArgs().slice(1, 5)).toEqual([800, 600, 1600, 1200]);
  });

  it("el canvas toma la FORMA del recorte, no la de la foto original", async () => {
    // Una franja 16:9 sobre una foto 4:3: el archivo publicado tiene que salir
    // apaisado, o el recorte no existió.
    const canvas = document.createElement("canvas");
    vi.spyOn(document, "createElement").mockReturnValue(canvas);
    await bakePhoto(makeFile(), { crop: { x: 0, y: 0.25, width: 1, height: 0.5 } });
    expect(canvas.width / canvas.height).toBeCloseTo(3200 / 1200, 2);
  });

  it("recortar NO agranda: una porción chica sale con sus propios píxeles", async () => {
    // Un 10% de 3200×2400 son 320×240, muy por debajo del tope: interpolar
    // hasta MAX_LONG_SIDE sería inventar píxeles y engordar el archivo.
    await bakePhoto(makeFile(), { crop: { x: 0.4, y: 0.4, width: 0.1, height: 0.1 } });
    expect(drawArgs().slice(5)).toEqual([0, 0, 320, 240]);
  });
});

describe("bakePhoto — los emojis se queman arriba de todo", () => {
  it("dibuja un emoji por sticker", async () => {
    await bakePhoto(makeFile(), {
      stickers: [sticker({ id: "a", emoji: "🔥" }), sticker({ id: "b", emoji: "❤️" })],
    });
    const dibujados = currentCtx.fillText.mock.calls.map((call) => call[0]);
    expect(dibujados).toEqual(["🔥", "❤️"]);
  });

  it("los ubica con la MISMA cuenta que la vista previa (fracción del recuadro)", async () => {
    // Foto 3200×2400 → canvas 1600×1200. Un sticker en (0.25, 0.75) tiene que
    // caer en (400, 900): si la cuenta se hiciera acá aparte, este número sería
    // el primero en separarse del que muestra la pantalla.
    await bakePhoto(makeFile(), { stickers: [sticker({ x: 0.25, y: 0.75 })] });
    const [, x, y] = currentCtx.fillText.mock.calls.at(-1) as [string, number, number];
    expect(x).toBe(400);
    expect(y).toBe(900);
  });

  it("van DESPUÉS del texto: quien los puso los vio arriba", async () => {
    await bakePhoto(makeFile(), {
      caption: { text: "Hola", position: "bottom", background: "none" },
      stickers: [sticker({ emoji: "🎉" })],
    });
    const dibujados = currentCtx.fillText.mock.calls.map((call) => call[0]);
    expect(dibujados.at(-1)).toBe("🎉");
  });

  it("sin emojis no toca el contexto de texto", async () => {
    await bakePhoto(makeFile(), { stickers: [] });
    expect(currentCtx.fillText).not.toHaveBeenCalled();
  });

  it("nunca dibuja más de los que entran (MAX_STICKERS)", async () => {
    const muchos = Array.from({ length: 20 }, (_, index) =>
      sticker({ id: `s${index}`, emoji: "⭐" }),
    );
    await bakePhoto(makeFile(), { stickers: muchos });
    expect(currentCtx.fillText.mock.calls).toHaveLength(8);
  });
});

describe("bakePhoto — color y tipografía del texto", () => {
  it("usa la tinta elegida, no el blanco por defecto", async () => {
    const fills: string[] = [];
    // `fillStyle` se pisa varias veces (barra y texto): se captura cada valor
    // en el momento de dibujar, que es lo único que importa.
    currentCtx.fillText.mockImplementation(() => {
      fills.push(currentCtx.fillStyle);
    });
    await bakePhoto(makeFile(), {
      caption: { text: "Hola", position: "bottom", background: "none", color: "amarillo" },
    });
    expect(fills).toContain(resolveCaptionColor("amarillo").fill);
  });

  it("sin color elegido se queda en el blanco de siempre (una edición vieja no cambia)", async () => {
    const fills: string[] = [];
    currentCtx.fillText.mockImplementation(() => {
      fills.push(currentCtx.fillStyle);
    });
    await bakePhoto(makeFile(), {
      caption: { text: "Hola", position: "bottom", background: "none" },
    });
    expect(fills).toContain("#f7f6f3");
  });

  it("una tinta OSCURA con fondo pinta una barra CLARA — o el texto no se lee", async () => {
    const barras: string[] = [];
    currentCtx.fillRect.mockImplementation(() => {
      barras.push(currentCtx.fillStyle);
    });
    await bakePhoto(makeFile(), {
      caption: { text: "Hola", position: "top", background: "solid", color: "negro" },
    });
    expect(barras[0]).toBe("rgba(247, 246, 243, 0.72)");
  });

  it("la tipografía elegida llega a ctx.font", async () => {
    const fuentes: string[] = [];
    currentCtx.fillText.mockImplementation(() => {
      fuentes.push(currentCtx.font);
    });
    await bakePhoto(makeFile(), {
      caption: { text: "Hola", position: "bottom", background: "none", font: "clasica" },
    });
    expect(fuentes[0]).toContain("Georgia");
  });

  it("avisa cuando la tipografía no estaba disponible (el canvas cambia de letra sin decir nada)", async () => {
    const aviso = vi.fn();
    // `document.fonts` con un `check` que dice que no: es exactamente lo que
    // pasa cuando la familia todavía no cargó.
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: vi.fn(async () => []), check: vi.fn(() => false) },
    });
    await bakePhoto(makeFile(), {
      caption: { text: "Hola", position: "bottom", background: "none", font: "titular" },
      onFontFallback: aviso,
    });
    expect(aviso).toHaveBeenCalledWith("Titular");
  });

  it("no avisa nada cuando la tipografía SÍ estaba", async () => {
    const aviso = vi.fn();
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: vi.fn(async () => []), check: vi.fn(() => true) },
    });
    await bakePhoto(makeFile(), {
      caption: { text: "Hola", position: "bottom", background: "none", font: "titular" },
      onFontFallback: aviso,
    });
    expect(aviso).not.toHaveBeenCalled();
  });
});
