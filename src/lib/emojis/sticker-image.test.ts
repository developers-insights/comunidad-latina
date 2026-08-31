// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadStickerImages } from "./sticker-image";

/**
 * LA CARGA DE LOS EMOJIS DE IMAGEN PARA EL CANVAS.
 *
 * Se testea porque acá vive la decisión que, si se rompe, se lleva puesta la
 * edición ENTERA de una foto: sin `crossOrigin = "anonymous"` la imagen del
 * bucket ensucia el canvas, `toBlob()` tira SecurityError, `bakePhoto` cae a su
 * respaldo y la persona publica la foto sin recorte, sin filtro y sin texto —
 * por un adorno. Es la clase de fallo que no se ve en una revisión visual
 * porque en el editor todo se veía bien.
 *
 * `Image` de jsdom nunca dispara `load`, así que se reemplaza por una que sí:
 * lo que importa medir es QUÉ le pedimos al navegador, no que el navegador de
 * mentira baje algo.
 */

interface FakeImage {
  crossOrigin: string | null;
  decoding: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
}

const creadas: FakeImage[] = [];
/** URLs que este falso navegador va a rechazar. */
const rotas = new Set<string>();

const ImagenOriginal = globalThis.Image;

beforeEach(() => {
  creadas.length = 0;
  rotas.clear();
  globalThis.Image = class {
    crossOrigin: string | null = null;
    decoding = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    #src = "";

    constructor() {
      creadas.push(this as unknown as FakeImage);
    }

    get src() {
      return this.#src;
    }
    set src(value: string) {
      this.#src = value;
      // Asíncrono como en un navegador de verdad: si resolviera en la misma
      // línea, el test pasaría aunque el código asignara `src` ANTES de
      // `crossOrigin`, que es justo el error que se quiere impedir.
      queueMicrotask(() => {
        if (rotas.has(value)) this.onerror?.();
        else this.onload?.();
      });
    }
  } as unknown as typeof Image;
});

afterEach(() => {
  globalThis.Image = ImagenOriginal;
  vi.restoreAllMocks();
});

describe("loadStickerImages", () => {
  it("pide CORS: sin esto el canvas queda tainted y se pierde la edición entera", async () => {
    await loadStickerImages(["https://cdn.test/klk.png"]);
    expect(creadas).toHaveLength(1);
    expect(creadas[0]!.crossOrigin).toBe("anonymous");
  });

  it("`crossOrigin` se asigna ANTES del `src`: después ya no re-emite el pedido", async () => {
    await loadStickerImages(["https://cdn.test/klk.png"]);
    // Si el orden estuviera al revés, la imagen habría resuelto (microtask del
    // setter de `src`) con `crossOrigin` todavía en null.
    expect(creadas[0]!.crossOrigin).toBe("anonymous");
    expect(creadas[0]!.src).toBe("https://cdn.test/klk.png");
  });

  it("el mismo dibujo repetido es UNA sola descarga", async () => {
    const url = "https://cdn.test/klk.png";
    const mapa = await loadStickerImages([url, url, url]);
    expect(creadas).toHaveLength(1);
    expect(mapa.size).toBe(1);
  });

  it("lo que no carga simplemente no está: se publica sin ese dibujo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rotas.add("https://cdn.test/roto.png");

    const mapa = await loadStickerImages([
      "https://cdn.test/klk.png",
      "https://cdn.test/roto.png",
    ]);

    expect(mapa.has("https://cdn.test/klk.png")).toBe(true);
    expect(mapa.has("https://cdn.test/roto.png")).toBe(false);
  });

  it("una imagen rota queda LOGUEADA, no se pierde en silencio", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    rotas.add("https://cdn.test/roto.png");
    await loadStickerImages(["https://cdn.test/roto.png"]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("no se pudo cargar"), "https://cdn.test/roto.png");
  });

  it("nunca rechaza: una publicación no se cae por un adorno", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rotas.add("https://cdn.test/a.png");
    rotas.add("https://cdn.test/b.png");
    await expect(loadStickerImages(["https://cdn.test/a.png", "https://cdn.test/b.png"])).resolves.toBeInstanceOf(Map);
  });

  it("sin emojis de imagen no se crea ninguna descarga", async () => {
    const mapa = await loadStickerImages([]);
    expect(creadas).toHaveLength(0);
    expect(mapa.size).toBe(0);
  });
});
