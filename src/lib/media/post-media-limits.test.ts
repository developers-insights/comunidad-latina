import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  MAX_PICKED_PHOTO_BYTES,
  MAX_TOTAL_PHOTO_BYTES,
  MAX_VIDEOS,
  checkPhotoPayload,
} from "./post-media-limits";

/**
 * FUENTE ÚNICA DE LOS LÍMITES DE FOTO. Este archivo existe porque el tope de
 * fotos estuvo escrito DOS veces —10 en el composer, 4 en la server action— y
 * publicar con fotos quedó roto sin que ningún test se enterara. Acá se prueba
 * la regla, no el número: los dos lados llaman a `checkPhotoPayload`.
 */

/** `MAX_PHOTOS` fotos de `bytes` cada una. */
function sizes(count: number, bytes: number): number[] {
  return Array.from({ length: count }, () => bytes);
}

describe("checkPhotoPayload — el cupo de fotos", () => {
  it("acepta una publicación sin fotos (un texto o una pregunta)", () => {
    expect(checkPhotoPayload([])).toEqual({ ok: true });
  });

  it("acepta las 10 fotos del composer si son livianas", () => {
    expect(checkPhotoPayload(sizes(MAX_PHOTOS, 400 * 1024))).toEqual({ ok: true });
  });

  it("rechaza la foto número 11 por cupo", () => {
    expect(checkPhotoPayload(sizes(MAX_PHOTOS + 1, 100 * 1024))).toEqual({
      ok: false,
      reason: "count",
    });
  });
});

describe("checkPhotoPayload — el peso, por archivo y en conjunto", () => {
  it("rechaza una sola foto por encima del techo por archivo", () => {
    expect(checkPhotoPayload([MAX_PHOTO_BYTES + 1])).toEqual({
      ok: false,
      reason: "photo",
    });
  });

  it("acepta una foto justo en el techo (el límite incluye su propio valor)", () => {
    expect(checkPhotoPayload([MAX_PHOTO_BYTES])).toEqual({ ok: true });
  });

  it("rechaza el CONJUNTO aunque cada foto entre sola", () => {
    // Un puñado de fotos que pasan una por una y sumadas se van del
    // presupuesto: es exactamente el caso que hacía morir el request contra el
    // límite de Next sin que nadie pudiera explicarle a la persona qué pasó.
    const each = Math.floor(MAX_TOTAL_PHOTO_BYTES / MAX_PHOTOS) + 1024;
    expect(each).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
    expect(checkPhotoPayload(sizes(MAX_PHOTOS, each))).toEqual({
      ok: false,
      reason: "total",
    });
  });

  it("el cupo se revisa ANTES que el peso: 11 fotos livianas son 'count'", () => {
    expect(checkPhotoPayload(sizes(MAX_PHOTOS + 1, 10))).toEqual({
      ok: false,
      reason: "count",
    });
  });
});

describe("los números tienen que cerrar entre sí", () => {
  it("el techo por archivo deja lugar a una foto horneada con margen de sobra", () => {
    // `bakePhoto` entrega ~250-800 KB (1600 px de lado largo, JPEG 0.85). El
    // techo por archivo tiene que estar cómodamente por encima de eso, y muy
    // por debajo de lo que se acepta elegir del disco.
    expect(MAX_PHOTO_BYTES).toBeGreaterThan(1024 * 1024);
    expect(MAX_PHOTO_BYTES).toBeLessThan(MAX_PICKED_PHOTO_BYTES);
  });

  it("el presupuesto total alcanza para 10 fotos horneadas reales", () => {
    expect(MAX_TOTAL_PHOTO_BYTES).toBeGreaterThanOrEqual(MAX_PHOTOS * 1024 * 1024);
  });

  it("el video no viaja por acá: sigue siendo 1 y sube directo al bucket", () => {
    expect(MAX_VIDEOS).toBe(1);
  });

  /**
   * EL CANDADO QUE FALTABA. `bodySizeLimit` vive en `next.config.ts` (Next lo
   * lee al arrancar; no se puede calcular desde un módulo de `src/` sin
   * arrastrar el config a otro pipeline), así que la coherencia se verifica acá:
   * TODO payload que el servidor bendice tiene que poder llegar físicamente.
   */
  it("bodySizeLimit de next.config.ts deja pasar todo lo que el servidor acepta", () => {
    const config = readFileSync(
      path.join(process.cwd(), "next.config.ts"),
      "utf8",
    );
    const match = config.match(/bodySizeLimit:\s*"(\d+)mb"/);
    expect(match, "next.config.ts tiene que declarar serverActions.bodySizeLimit").toBeTruthy();

    const limitBytes = Number(match![1]) * 1024 * 1024;
    // Con margen para el overhead de multipart (bordes, headers de cada parte)
    // y para el cuerpo de hasta 2000 caracteres: los docs de Next hablan de
    // 10-20 KB, acá sobra un mundo.
    expect(limitBytes).toBeGreaterThan(MAX_TOTAL_PHOTO_BYTES + 512 * 1024);
  });
});
