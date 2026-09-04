import { describe, expect, it } from "vitest";
import { isOwnPosterPath, isOwnVideoPath } from "./own-media-path";

/**
 * "ESTA RUTA ES MÍA" — la regla que impide colgarse del archivo de otro.
 *
 * Estos casos vivían dentro de los tests de `feed/actions`. Salieron con la
 * función: desde que el video publicitario entra por `/impulsar-post`, la regla
 * la comparten dos caminos, y un test que sólo cubre a uno de los dos deja al
 * otro sin red justo donde más duele — el bucket es público de lectura.
 */

const TENANT = "019fa477-58e6-7ab9-ae4f-cc41716f6419";
const USER = "019fa477-58e6-7ab9-ae4f-cc41716f6420";
const OTRO = "019fa477-58e6-7ab9-ae4f-cc41716f6421";

describe("isOwnVideoPath", () => {
  it("acepta el prefijo propio con una extensión del catálogo", () => {
    expect(isOwnVideoPath(`${TENANT}/${USER}/video-1.mp4`, TENANT, USER)).toBe(true);
    // El .mov de iPhone es el caso que estuvo roto: el picker lo dejaba elegir y
    // la regla del servidor lo rechazaba en silencio recién al publicar.
    expect(isOwnVideoPath(`${TENANT}/${USER}/video-1.mov`, TENANT, USER)).toBe(true);
  });

  it("rechaza el prefijo de OTRA persona", () => {
    expect(isOwnVideoPath(`${TENANT}/${OTRO}/video-1.mp4`, TENANT, USER)).toBe(false);
  });

  it("rechaza el prefijo de OTRA comunidad", () => {
    expect(isOwnVideoPath(`${OTRO}/${USER}/video-1.mp4`, TENANT, USER)).toBe(false);
  });

  it("rechaza más o menos de tres segmentos, y el traversal", () => {
    expect(isOwnVideoPath(`${TENANT}/${USER}/sub/video.mp4`, TENANT, USER)).toBe(false);
    expect(isOwnVideoPath(`${USER}/video.mp4`, TENANT, USER)).toBe(false);
    expect(isOwnVideoPath(`${TENANT}/${USER}/../otro.mp4`, TENANT, USER)).toBe(false);
  });

  it("rechaza una extensión que el bucket no acepta", () => {
    expect(isOwnVideoPath(`${TENANT}/${USER}/video.exe`, TENANT, USER)).toBe(false);
    // Y un .jpg tampoco es un video: la portada tiene su propia función.
    expect(isOwnVideoPath(`${TENANT}/${USER}/poster.jpg`, TENANT, USER)).toBe(false);
  });
});

describe("isOwnPosterPath", () => {
  it("acepta un .jpg del prefijo propio", () => {
    expect(isOwnPosterPath(`${TENANT}/${USER}/poster-1.jpg`, TENANT, USER)).toBe(true);
  });

  it("rechaza cualquier otra extensión — el CHECK de la 0132 dice lo mismo", () => {
    expect(isOwnPosterPath(`${TENANT}/${USER}/poster-1.png`, TENANT, USER)).toBe(false);
    expect(isOwnPosterPath(`${TENANT}/${USER}/video-1.mp4`, TENANT, USER)).toBe(false);
  });

  it("rechaza el prefijo ajeno y el traversal", () => {
    expect(isOwnPosterPath(`${TENANT}/${OTRO}/poster.jpg`, TENANT, USER)).toBe(false);
    expect(isOwnPosterPath(`${TENANT}/${USER}/../p.jpg`, TENANT, USER)).toBe(false);
  });
});
