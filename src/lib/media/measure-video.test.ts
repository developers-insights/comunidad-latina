// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeDeclaredDuration } from "./video-policy";
import { readVideoDurationSeconds, readVideoIntro } from "./measure-video";

/**
 * ABRIR EL ARCHIVO UNA SOLA VEZ Y SACARLE LAS DOS COSAS.
 *
 * Este módulo mide la duración del video antes de subirlo (el tope de 90 s tiene
 * que rebotar ANTES de gastarle los datos a la persona) y, desde la 0132,
 * captura también el primer cuadro — el `poster` que hace que el video no salga
 * en blanco mientras carga en el reel.
 *
 * Las dos preguntas van en la MISMA apertura, y eso es justamente lo que hay que
 * anclar: abrir el archivo es lo caro —hasta 200 MB decodificándose en un
 * teléfono— y hacerlo dos veces sería pagar ese precio al pepe.
 *
 * jsdom no decodifica video ni pinta canvas, así que acá se falsean los dos
 * elementos del DOM. Lo que se testea NO es que el navegador sepa sacar un
 * fotograma (eso lo sabe): es el CONTRATO de esta función — cuántas veces abre
 * el archivo, qué devuelve cuando algo falla, y que nunca lance.
 */

interface VideoFalso {
  preload: string;
  muted: boolean;
  playsInline: boolean;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  currentTime: number;
  onloadedmetadata: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener: (evento: string, cb: () => void) => void;
  removeEventListener: (evento: string, cb: () => void) => void;
  removeAttribute: (nombre: string) => void;
  load: () => void;
}

interface Escenario {
  /** Cuántos `<video>` se crearon: la cuenta de aperturas del archivo. */
  aperturas: number;
  /** ¿Se dibujó un fotograma en un canvas? */
  dibujos: number;
  /** Lo último que se le pidió al canvas como tipo de imagen. */
  tipoDeImagen: string | null;
  /** Tamaño del canvas al dibujar — el poster se achica, no va a resolución completa. */
  tamaño: { width: number; height: number } | null;
}

/**
 * Reemplaza `document.createElement` para "video" y "canvas". Todo lo demás
 * sigue creando elementos de verdad.
 */
function montarEscenario({
  metadata = true,
  duration = 42,
  videoWidth = 1080,
  videoHeight = 1920,
  seek = true,
  blob = true,
}: {
  metadata?: boolean;
  duration?: number;
  videoWidth?: number;
  videoHeight?: number;
  seek?: boolean;
  blob?: boolean;
} = {}): Escenario {
  const escenario: Escenario = {
    aperturas: 0,
    dibujos: 0,
    tipoDeImagen: null,
    tamaño: null,
  };

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:falso",
    revokeObjectURL: () => undefined,
  });

  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((etiqueta: string) => {
    if (etiqueta === "video") {
      escenario.aperturas += 1;
      const listeners = new Map<string, () => void>();
      const video: VideoFalso = {
        preload: "",
        muted: false,
        playsInline: false,
        duration,
        videoWidth,
        videoHeight,
        currentTime: 0,
        onloadedmetadata: null,
        onerror: null,
        addEventListener: (evento, cb) => listeners.set(evento, cb),
        removeEventListener: (evento) => listeners.delete(evento),
        removeAttribute: () => undefined,
        load: () => undefined,
      };
      // `src` dispara la carga, igual que en el navegador.
      Object.defineProperty(video, "src", {
        set() {
          queueMicrotask(() => {
            if (metadata) video.onloadedmetadata?.();
            else video.onerror?.();
          });
        },
      });
      // Mover el reloj emite `seeked` — o no, si el escenario dice que el
      // archivo no puede buscar (contenedor raro, stream sin índice).
      let reloj = 0;
      Object.defineProperty(video, "currentTime", {
        get: () => reloj,
        set(valor: number) {
          reloj = valor;
          if (seek) queueMicrotask(() => listeners.get("seeked")?.());
        },
      });
      return video as unknown as HTMLElement;
    }

    if (etiqueta === "canvas") {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {
            escenario.dibujos += 1;
            escenario.tamaño = { width: canvas.width, height: canvas.height };
          },
        }),
        toBlob: (cb: (blob: Blob | null) => void, tipo: string) => {
          escenario.tipoDeImagen = tipo;
          cb(blob ? new Blob(["x"], { type: tipo }) : null);
        },
      };
      return canvas as unknown as HTMLElement;
    }

    return original(etiqueta);
  }) as typeof document.createElement);

  return escenario;
}

const ARCHIVO = new File(["video"], "IMG_4821.MOV", { type: "video/quicktime" });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("readVideoIntro — duración y poster en la MISMA apertura", () => {
  it("devuelve las dos cosas abriendo el archivo una sola vez", async () => {
    const escenario = montarEscenario({ duration: 42 });

    const intro = await readVideoIntro(ARCHIVO);

    expect(intro.durationSeconds).toBe(normalizeDeclaredDuration(42));
    expect(intro.poster).toBeInstanceOf(Blob);
    // LA LÍNEA QUE IMPORTA: un `<video>`, no dos. Si alguien parte esto en dos
    // funciones que abren el archivo cada una, este test lo frena.
    expect(escenario.aperturas).toBe(1);
  });

  it("el poster es un JPEG achicado, no el cuadro a resolución completa", () => {
    // Se pinta MIENTRAS el video carga, así que un poster pesado competiría por
    // el ancho de banda con el archivo que está tapando.
    const escenario = montarEscenario({ videoWidth: 1080, videoHeight: 1920 });

    return readVideoIntro(ARCHIVO).then(() => {
      expect(escenario.tipoDeImagen).toBe("image/jpeg");
      expect(escenario.tamaño).toEqual({ width: 405, height: 720 });
    });
  });

  it("respeta la proporción del video: un horizontal no sale recortado", async () => {
    const escenario = montarEscenario({ videoWidth: 1920, videoHeight: 1080 });

    await readVideoIntro(ARCHIVO);

    expect(escenario.tamaño).toEqual({ width: 720, height: 405 });
  });

  it("sin poster pedido no dibuja nada (la ruta de Mux trae su propia miniatura)", async () => {
    const escenario = montarEscenario();

    const intro = await readVideoIntro(ARCHIVO, { wantPoster: false });

    expect(intro.durationSeconds).toBe(normalizeDeclaredDuration(42));
    expect(intro.poster).toBeNull();
    expect(escenario.dibujos).toBe(0);
  });
});

describe("readVideoIntro — un poster que no sale nunca frena una publicación", () => {
  it("sin metadata no hay ni duración ni poster, y no lanza", async () => {
    const escenario = montarEscenario({ metadata: false });

    const intro = await readVideoIntro(ARCHIVO);

    expect(intro).toEqual({ durationSeconds: null, poster: null });
    // Y ni siquiera se INTENTA el fotograma: si el navegador no pudo abrir el
    // contenedor, tampoco va a poder dibujarlo — esperar seis segundos a un
    // `seeked` que no va a llegar sería tiempo regalado.
    expect(escenario.dibujos).toBe(0);
  });

  it("un archivo que no puede buscar devuelve la duración igual, sin poster", async () => {
    montarEscenario({ seek: false });

    const intro = await readVideoIntro(ARCHIVO);

    expect(intro.durationSeconds).toBe(normalizeDeclaredDuration(42));
    expect(intro.poster).toBeNull();
  }, 10_000);

  it("un video sin dimensiones (audio disfrazado) tampoco rompe", async () => {
    montarEscenario({ videoWidth: 0, videoHeight: 0 });

    const intro = await readVideoIntro(ARCHIVO);

    expect(intro.poster).toBeNull();
  });

  it("un canvas que no devuelve blob deja el poster en null", async () => {
    montarEscenario({ blob: false });

    const intro = await readVideoIntro(ARCHIVO);

    expect(intro.poster).toBeNull();
  });
});

describe("readVideoDurationSeconds — el contrato viejo no cambió", () => {
  it("sigue devolviendo sólo el número, y sin pagar el fotograma", async () => {
    const escenario = montarEscenario({ duration: 90 });

    await expect(readVideoDurationSeconds(ARCHIVO)).resolves.toBe(
      normalizeDeclaredDuration(90),
    );
    expect(escenario.dibujos).toBe(0);
  });

  it("null cuando el navegador no pudo abrir el archivo", async () => {
    montarEscenario({ metadata: false });

    await expect(readVideoDurationSeconds(ARCHIVO)).resolves.toBeNull();
  });
});
