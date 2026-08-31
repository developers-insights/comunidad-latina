import { describe, expect, it } from "vitest";
import {
  PHOTO_ACCEPT_ATTR,
  PHOTO_TYPES,
  isAcceptedPhotoType,
  isHeicPhoto,
} from "./photo-upload-limits";

/**
 * FUENTE ÚNICA DE FORMATO DE FOTO. Nace del mismo reporte del cliente que ya
 * arregló el `.mov` de video ("problema con... el tipo de formato... con las
 * imágenes"): una foto de iPhone en HEIC (el formato de fábrica desde iOS 11)
 * se rechazaba con un mensaje genérico que no explicaba nada.
 */

describe("PHOTO_ACCEPT_ATTR — generado desde PHOTO_TYPES, nunca a mano", () => {
  it("es exactamente PHOTO_TYPES unido por comas", () => {
    expect(PHOTO_ACCEPT_ATTR).toBe(PHOTO_TYPES.join(","));
  });

  it("no incluye HEIC — decisión, no olvido (ver el docblock del módulo)", () => {
    expect(PHOTO_ACCEPT_ATTR).not.toContain("heic");
  });
});

describe("isAcceptedPhotoType — el catálogo final: jpeg, png, webp", () => {
  for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
    it(`acepta ${mime}`, () => {
      expect(isAcceptedPhotoType({ type: mime })).toBe(true);
    });
  }

  for (const mime of ["image/heic", "image/heif", "image/gif", "application/pdf", ""]) {
    it(`rechaza ${mime || "(vacío)"}`, () => {
      expect(isAcceptedPhotoType({ type: mime })).toBe(false);
    });
  }
});

describe("isHeicPhoto — detecta el formato de cámara de iPhone (para el MENSAJE, nunca para aceptarlo)", () => {
  it("por MIME image/heic", () => {
    expect(isHeicPhoto({ type: "image/heic", name: "foto.heic" })).toBe(true);
  });

  it("por MIME image/heif", () => {
    expect(isHeicPhoto({ type: "image/heif", name: "foto.heif" })).toBe(true);
  });

  it("variantes de ráfaga / Live Photo", () => {
    expect(isHeicPhoto({ type: "image/heic-sequence", name: "foto.heic" })).toBe(true);
    expect(isHeicPhoto({ type: "image/heif-sequence", name: "foto.heif" })).toBe(true);
  });

  it("el nombre real de la Cámara de iOS, con MIME vacío (gotcha de Android/navegadores viejos)", () => {
    // Mismo caso que ya documenta video-upload-limits.ts: algunos navegadores
    // no reportan MIME para formatos poco comunes — cae al nombre de archivo.
    expect(isHeicPhoto({ type: "", name: "IMG_1234.HEIC" })).toBe(true);
  });

  it("MIME genérico (application/octet-stream) con extensión .heif", () => {
    expect(isHeicPhoto({ type: "application/octet-stream", name: "foto.heif" })).toBe(true);
  });

  it("NO confunde un JPEG con nombre parecido", () => {
    expect(isHeicPhoto({ type: "image/jpeg", name: "foto.jpg" })).toBe(false);
  });

  it("NO confunde un archivo sin extensión", () => {
    expect(isHeicPhoto({ type: "image/jpeg", name: "foto-sin-extension" })).toBe(false);
  });

  it("un HEIC nunca es un tipo aceptado, aunque isHeicPhoto lo identifique", () => {
    const file = { type: "image/heic", name: "IMG_1234.HEIC" };
    expect(isHeicPhoto(file)).toBe(true);
    expect(isAcceptedPhotoType(file)).toBe(false);
  });
});
