// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PHOTO_FILE_ACCEPT,
  checkPickedPhoto,
  isAcceptedPhotoFile,
  looksLikeHeic,
  probePhotoDecodable,
} from "./photo-input";
import { MAX_PICKED_PHOTO_BYTES } from "./post-media-limits";

/**
 * QUÉ FOTO ENTRA — la puerta del navegador.
 *
 * Existe por el reporte del cliente (2026-08-26): "el mismo problema con los
 * videos grandes o el tipo de formato de video pasa con las imágenes". Las dos
 * puertas que rebotaban fotos reales eran el TIPO (faltaba HEIC, el default de
 * cualquier iPhone) y el PESO al elegir. El porqué del camino elegido está en
 * el docblock de `photo-input.ts`.
 */

function file(name: string, type: string, size = 1024): { name: string; type: string; size: number } {
  return { name, type, size };
}

describe("formatos aceptados", () => {
  it("los tres de siempre siguen entrando", () => {
    expect(isAcceptedPhotoFile(file("a.jpg", "image/jpeg"))).toBe(true);
    expect(isAcceptedPhotoFile(file("a.png", "image/png"))).toBe(true);
    expect(isAcceptedPhotoFile(file("a.webp", "image/webp"))).toBe(true);
  });

  it("HEIC y HEIF ahora también — es lo que graba un iPhone por defecto", () => {
    expect(isAcceptedPhotoFile(file("IMG_0042.heic", "image/heic"))).toBe(true);
    expect(isAcceptedPhotoFile(file("IMG_0042.heif", "image/heif"))).toBe(true);
    expect(isAcceptedPhotoFile(file("IMG_0042.heic", "image/heic-sequence"))).toBe(true);
  });

  it("un HEIC SIN tipo entra por la extensión (varios pickers de Android no lo informan)", () => {
    expect(isAcceptedPhotoFile(file("IMG_0042.HEIC", ""))).toBe(true);
    expect(isAcceptedPhotoFile(file("foto.JPG", ""))).toBe(true);
  });

  it("lo que no es una foto no entra", () => {
    expect(isAcceptedPhotoFile(file("clip.mp4", "video/mp4"))).toBe(false);
    expect(isAcceptedPhotoFile(file("doc.pdf", "application/pdf"))).toBe(false);
    expect(isAcceptedPhotoFile(file("raw.dng", "image/x-adobe-dng"))).toBe(false);
  });

  it("un archivo con tipo declarado NO reconocido no se cuela por el nombre", () => {
    // Un PDF renombrado a .jpg: el nombre es lo último que se mira, y sólo
    // cuando el navegador no dijo nada.
    expect(isAcceptedPhotoFile(file("trampa.jpg", "application/pdf"))).toBe(false);
  });

  it("el accept del input lista MIME y extensiones (sin las dos, el picker lo muestra EN GRIS)", () => {
    expect(PHOTO_FILE_ACCEPT).toContain("image/heic");
    expect(PHOTO_FILE_ACCEPT).toContain(".heic");
    expect(PHOTO_FILE_ACCEPT).toContain("image/jpeg");
  });
});

describe("looksLikeHeic — decide QUÉ mensaje se muestra", () => {
  it("reconoce por tipo y por extensión", () => {
    expect(looksLikeHeic(file("a.heic", "image/heic"))).toBe(true);
    expect(looksLikeHeic(file("a.HEIF", ""))).toBe(true);
  });

  it("un JPG no es HEIC: su fallo es 'archivo dañado', no 'formato del iPhone'", () => {
    expect(looksLikeHeic(file("a.jpg", "image/jpeg"))).toBe(false);
  });
});

describe("checkPickedPhoto — tipo y peso, sin decodificar", () => {
  it("acepta una foto normal", () => {
    expect(checkPickedPhoto(file("a.jpg", "image/jpeg", 4_000_000), MAX_PICKED_PHOTO_BYTES)).toEqual({
      ok: true,
    });
  });

  it("una foto de 48 MP (12 MB) ya NO rebota: es una foto de teléfono cualquiera", () => {
    // Es exactamente el caso que reportó el cliente. Con el tope viejo de 5 MB
    // esto devolvía `size`.
    expect(
      checkPickedPhoto(file("IMG.jpg", "image/jpeg", 12 * 1024 * 1024), MAX_PICKED_PHOTO_BYTES),
    ).toEqual({ ok: true });
  });

  it("un archivo descomunal sí rebota: el límite es la memoria del teléfono", () => {
    expect(
      checkPickedPhoto(file("raw.jpg", "image/jpeg", 60 * 1024 * 1024), MAX_PICKED_PHOTO_BYTES),
    ).toEqual({ ok: false, reason: "size" });
  });

  it("el TIPO se mira antes que el peso: un video enorme es 'type', no 'size'", () => {
    // El motivo tiene que ser el más específico, porque es el que se muestra.
    expect(
      checkPickedPhoto(file("clip.mp4", "video/mp4", 900 * 1024 * 1024), MAX_PICKED_PHOTO_BYTES),
    ).toEqual({ ok: false, reason: "type" });
  });
});

describe("probePhotoDecodable — ¿este navegador puede abrirla?", () => {
  beforeEach(() => {
    // El motivo real se loguea siempre (nunca un catch mudo): acá se silencia
    // porque lo estamos provocando a propósito.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function realFile(name: string, type: string): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type });
  }

  it("una imagen que decodifica pasa", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close })));
    expect(await probePhotoDecodable(realFile("a.jpg", "image/jpeg"))).toEqual({ ok: true });
    // Y se cierra: un bitmap de 48 MP retenido son cientos de MB de RAM.
    expect(close).toHaveBeenCalled();
  });

  it("un HEIC que este navegador no sabe abrir devuelve 'heic', no 'archivo roto'", async () => {
    // Chrome en Android con una foto que llegó de un iPhone. El archivo está
    // perfecto: decirle a la persona que está dañado sería mentirle, porque la
    // ve bien en su galería.
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("The source image could not be decoded.");
      }),
    );
    expect(await probePhotoDecodable(realFile("IMG.heic", "image/heic"))).toEqual({
      ok: false,
      reason: "heic",
    });
  });

  it("un JPG ilegible devuelve 'decode' — otro problema, otro mensaje", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("broken");
      }),
    );
    expect(await probePhotoDecodable(realFile("cortada.jpg", "image/jpeg"))).toEqual({
      ok: false,
      reason: "decode",
    });
  });

  it("nunca lanza: el fallo es un veredicto, no una excepción que alguien tenga que atrapar", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    await expect(probePhotoDecodable(realFile("a.jpg", "image/jpeg"))).resolves.toBeTruthy();
  });

  it("deja el motivo real en consola: sin eso, un reporte del cliente no se puede entender", async () => {
    const log = vi.spyOn(console, "error");
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("The source image could not be decoded.");
      }),
    );
    await probePhotoDecodable(realFile("IMG.heic", "image/heic"));
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toContain("IMG.heic");
  });

  it("sin createImageBitmap no rechaza nada: la puerta real es el navegador", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    expect(await probePhotoDecodable(realFile("a.jpg", "image/jpeg"))).toEqual({ ok: true });
  });
});
