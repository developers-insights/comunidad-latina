import { describe, it, expect } from "vitest";
import { selectPhotos, PHOTO_MAX_BYTES, PHOTO_MAX_COUNT } from "./helpers";

/**
 * `selectPhotos` es la lógica pura detrás de los dos composers de fotos
 * (publicar trabajo y perfil de creador). El bug real de "elijo foto y no se
 * marca ninguna" NO estaba acá sino en el caller (leía el FileList vivo dentro
 * de un updater diferido, después de limpiar el input) — eso se cubre con el
 * e2e. Acá se fija el contrato de cantidad/peso y, sobre todo, que el tope de
 * peso sea GENEROSO: bajarlo a 8 MB volvía a rechazar fotos normales de celular.
 */

const file = (bytes: number, name = "foto.jpg") =>
  new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });

describe("selectPhotos", () => {
  it("acepta fotos válidas y no marca ningún rechazo", () => {
    const r = selectPhotos([file(1000), file(2000)], 0);
    expect(r.accepted).toHaveLength(2);
    expect(r.tooMany).toBe(false);
    expect(r.tooBig).toBe(false);
  });

  it("marca las que pesan de más y sigue aceptando las demás (no corta)", () => {
    const big = file(100, "grande.jpg");
    const ok = file(5, "chica.jpg");
    const r = selectPhotos([big, ok], 0, PHOTO_MAX_COUNT, 10);
    expect(r.accepted).toEqual([ok]);
    expect(r.tooBig).toBe(true);
    expect(r.tooMany).toBe(false);
  });

  it("respeta el cupo restante según cuántas ya hay", () => {
    const r = selectPhotos([file(1), file(1)], PHOTO_MAX_COUNT - 1);
    expect(r.accepted).toHaveLength(1); // solo entra una: se llegó al tope
    expect(r.tooMany).toBe(true);
  });

  it("con el cupo lleno no acepta ninguna", () => {
    const r = selectPhotos([file(1)], PHOTO_MAX_COUNT);
    expect(r.accepted).toHaveLength(0);
    expect(r.tooMany).toBe(true);
  });

  it("el tope de peso por defecto es generoso (una foto de celular entra)", () => {
    // Ancla de regresión: 8 MB rechazaba fotos reales de celular. Acá exigimos
    // que el default sea holgado (≥ 20 MB) y que una foto de 12 MB pase.
    expect(PHOTO_MAX_BYTES).toBeGreaterThanOrEqual(20 * 1024 * 1024);
    const phone = file(12 * 1024 * 1024, "celular.jpg");
    expect(selectPhotos([phone], 0).accepted).toEqual([phone]);
  });
});
