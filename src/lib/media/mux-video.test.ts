import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MUX_STATUSES,
  MUX_UPLOAD_ENDPOINT,
  muxPlaybackMode,
  muxStatusIsPending,
  parseMuxStatus,
  requestMuxUpload,
} from "./mux-video";

/**
 * LAS DOS REGLAS QUE ESTE ARCHIVO EXISTE PARA QUE NO SE ROMPAN:
 *
 *  1. SIN CLAVES DE MUX, TODO SIGUE COMO HOY. El 503 de `/api/mux/subida` no es
 *     un error: es "usá el camino de siempre". Si alguien lo convierte en un
 *     `throw` o en un `{ ok: false, reason: "falló" }` genérico, el composer
 *     empieza a mostrarle disculpas a gente que no tiene ningún problema.
 *  2. LOS VIDEOS VIEJOS SIGUEN REPRODUCIÉNDOSE. 36 filas del bucket no tienen
 *     ni `mux_playback_id` ni `mux_status`, y tienen que caer en "archivo" —
 *     el `<video src>` de siempre.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseMuxStatus — catálogo cerrado, como el resto de las columnas de video", () => {
  for (const status of MUX_STATUSES) {
    it(`acepta "${status}"`, () => {
      expect(parseMuxStatus(status)).toBe(status);
    });
  }

  it("los cuatro valores son EXACTAMENTE los del contrato con el backend", () => {
    // Igualdad exacta y no "al menos estos". El catálogo se re-exporta de
    // `@/lib/mux/urls` —el mismo que escribe el webhook en la base— así que esto
    // no está comparando dos copias: está fijando el CONTRATO. Si mañana alguien
    // agrega un estado allá sin enseñarle a `muxPlaybackMode` qué pintar, este
    // test se pone rojo antes de que el bug llegue al feed. Y ese bug sería
    // mudo: un estado desconocido cae a "archivo" y el video simplemente no
    // aparece, sin ningún error en ningún lado.
    expect([...MUX_STATUSES]).toEqual(["uploading", "processing", "ready", "errored"]);
  });

  it("null para lo que no está en el catálogo, incluido el null de la columna", () => {
    expect(parseMuxStatus(null)).toBeNull();
    expect(parseMuxStatus(undefined)).toBeNull();
    expect(parseMuxStatus("")).toBeNull();
    expect(parseMuxStatus("listo")).toBeNull();
    expect(parseMuxStatus("READY")).toBeNull();
    expect(parseMuxStatus(7)).toBeNull();
  });
});

describe("muxPlaybackMode — los 36 videos del bucket siguen andando", () => {
  it("una fila sin nada de Mux se reproduce con el <video> de siempre", () => {
    expect(muxPlaybackMode({})).toBe("archivo");
    expect(muxPlaybackMode(null)).toBe("archivo");
    expect(muxPlaybackMode(undefined)).toBe("archivo");
    expect(muxPlaybackMode({ playbackId: null, status: null })).toBe("archivo");
  });

  it("un estado que no reconocemos NO rompe la tarjeta: cae al archivo", () => {
    expect(muxPlaybackMode({ playbackId: "abc", status: "vaya-a-saber" })).toBe("archivo");
  });
});

describe("muxPlaybackMode — nunca un reproductor vacío ni un cuadro negro", () => {
  it("listo Y con playbackId: reproductor de Mux", () => {
    expect(muxPlaybackMode({ playbackId: "abc123", status: "ready" })).toBe("mux");
  });

  it("listo pero SIN playbackId cae al archivo, no a un player sin video", () => {
    // Un `<MuxPlayer>` sin playbackId es exactamente el cuadro negro con
    // controles que no puede pasar. Si la fila quedó a medias, gana el archivo.
    expect(muxPlaybackMode({ playbackId: null, status: "ready" })).toBe("archivo");
    expect(muxPlaybackMode({ playbackId: "   ", status: "ready" })).toBe("archivo");
  });

  it("con playbackId pero todavía procesando NO reproduce", () => {
    // Mux escribe el id del asset ANTES de terminar de transcodificar: el HLS
    // todavía no existe y el player daría error.
    expect(muxPlaybackMode({ playbackId: "abc123", status: "processing" })).toBe("processing");
  });

  it("subiendo también es 'procesando' para quien mira", () => {
    expect(muxPlaybackMode({ status: "uploading" })).toBe("processing");
  });

  it("fallado se dice, no se disfraza de video que no carga", () => {
    expect(muxPlaybackMode({ playbackId: "abc123", status: "errored" })).toBe("errored");
  });
});

describe("muxStatusIsPending — a quién vale la pena sondear", () => {
  it("sólo los dos estados que todavía pueden cambiar solos", () => {
    expect(muxStatusIsPending("uploading")).toBe(true);
    expect(muxStatusIsPending("processing")).toBe(true);
    expect(muxStatusIsPending("ready")).toBe(false);
    expect(muxStatusIsPending("errored")).toBe(false);
    expect(muxStatusIsPending(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requestMuxUpload
// ---------------------------------------------------------------------------

function stubFetch(respuesta: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuesta as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const TICKET = {
  uploadId: "upl_1",
  uploadUrl: "https://storage.googleapis.com/upload/firmado",
  postDraftId: "11111111-1111-4111-8111-111111111111",
};

describe("requestMuxUpload — el 503 es el interruptor, no una falla", () => {
  it("503 devuelve 'sin-mux': quien llama cae al bucket EN SILENCIO", () => {
    stubFetch({ status: 503, ok: false });
    return expect(requestMuxUpload()).resolves.toEqual({ ok: false, reason: "sin-mux" });
  });

  it("pega en la ruta del contrato y no en otra", async () => {
    const fetchMock = stubFetch({ status: 503, ok: false });
    await requestMuxUpload();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(MUX_UPLOAD_ENDPOINT);
    expect(MUX_UPLOAD_ENDPOINT).toBe("/api/mux/subida");
  });
});

describe("requestMuxUpload — el camino feliz", () => {
  it("devuelve el ticket completo tal cual lo mandó el backend", async () => {
    stubFetch({ status: 200, ok: true, json: async () => TICKET });
    await expect(requestMuxUpload()).resolves.toEqual({ ok: true, ticket: TICKET });
  });
});

describe("requestMuxUpload — nunca tira, siempre contesta", () => {
  it("la red caída no explota: devuelve 'falló'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(requestMuxUpload()).resolves.toEqual({ ok: false, reason: "falló" });
  });

  it("un 500 del servidor tampoco explota", async () => {
    stubFetch({ status: 500, ok: false });
    await expect(requestMuxUpload()).resolves.toEqual({ ok: false, reason: "falló" });
  });

  it("un cuerpo que no es JSON tampoco", async () => {
    stubFetch({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    await expect(requestMuxUpload()).resolves.toEqual({ ok: false, reason: "falló" });
  });

  it("un 200 al que le falta un campo del contrato NO se toma por bueno", async () => {
    // Sin `uploadUrl` no hay nada contra qué subir: seguir adelante dejaría a
    // UpChunk apuntando a `undefined` y a la persona mirando una barra en 0%.
    for (const incompleto of [
      { uploadId: "upl_1", postDraftId: "p1" },
      { uploadUrl: "https://x", postDraftId: "p1" },
      { uploadId: "upl_1", uploadUrl: "https://x" },
      { uploadId: "", uploadUrl: "https://x", postDraftId: "p1" },
    ]) {
      stubFetch({ status: 200, ok: true, json: async () => incompleto });
      await expect(requestMuxUpload()).resolves.toEqual({ ok: false, reason: "falló" });
    }
  });
});
