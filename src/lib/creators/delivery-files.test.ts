import { describe, expect, it } from "vitest";
import {
  MAX_DELIVERY_FILE_BYTES,
  deliveryFolder,
  deliveryObjectPath,
  displayNameFromPath,
  isAllowedDeliveryFile,
  safeFileName,
} from "./delivery-files";

const T = "11111111-1111-4111-8111-111111111111";
const C = "0199aaaa-0000-7000-8000-000000000001";
const U = "22222222-2222-4222-8222-222222222222";

describe("rutas de entrega", () => {
  it("van a {tenant}/{contrato}/v{versión}/", () => {
    expect(deliveryFolder(T, C, 2)).toBe(`${T}/${C}/v2`);
    expect(deliveryObjectPath(T, C, 2, U, "Video final.mp4")).toBe(`${T}/${C}/v2/${U}-video-final.mp4`);
  });

  it("el nombre visible sale de la ruta, sin el prefijo aleatorio", () => {
    expect(displayNameFromPath(`${T}/${C}/v2/${U}-video-final.mp4`)).toBe("video-final.mp4");
  });

  it("limpia nombres peligrosos o raros", () => {
    expect(safeFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeFileName("Canción Ñandú (1).MOV")).toBe("cancion-nandu-1.mov");
    expect(safeFileName("sin extension")).toBe("sin-extension");
    expect(safeFileName("....")).toBe("archivo");
    expect(safeFileName(`${"a".repeat(200)}.mp4`).length).toBeLessThanOrEqual(84);
  });
});

describe("isAllowedDeliveryFile", () => {
  it("acepta video, foto, audio, PDF y ZIP", () => {
    for (const type of ["video/mp4", "video/quicktime", "image/jpeg", "image/png", "audio/mpeg", "application/pdf", "application/zip"]) {
      expect(isAllowedDeliveryFile({ name: "x", size: 1000, type })).toBe(true);
    }
  });

  it("rechaza ejecutables, HTML y lo que pasa de 200 MB", () => {
    expect(isAllowedDeliveryFile({ name: "x.exe", size: 10, type: "application/x-msdownload" })).toBe(false);
    expect(isAllowedDeliveryFile({ name: "x.html", size: 10, type: "text/html" })).toBe(false);
    expect(isAllowedDeliveryFile({ name: "x.mp4", size: MAX_DELIVERY_FILE_BYTES + 1, type: "video/mp4" })).toBe(false);
    expect(isAllowedDeliveryFile({ name: "x.mp4", size: 0, type: "video/mp4" })).toBe(false);
  });
});
