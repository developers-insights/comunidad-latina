import { describe, expect, it } from "vitest";
import { imagePhash } from "./image";
import { hammingDistance } from "./phash";
import { DEFAULT_MAX_DISTANCE } from "./scan";

/**
 * El camino completo de la huella de imagen, con archivos DE VERDAD.
 *
 * `phash.test.ts` prueba la matemática con matrices; esto prueba lo otro: que
 * decodificar un WebP y un JPEG de la misma foto —dos formatos, dos calidades,
 * dos tamaños— termine en huellas que se reconocen entre sí. Es el escenario
 * real de la plataforma: el composer convierte a WebP antes de subir, así que
 * la misma foto reaparece comprimida distinto.
 */

/** Foto sintética a color, con estructura suficiente para que el DCT vea algo. */
async function renderPhoto(size: number): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const channels = 3;
  const raw = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * channels;
      const inBlock = x < size / 3 && y < size / 3;
      raw[offset] = Math.round((x / size) * 255);
      raw[offset + 1] = Math.round((y / size) * 255);
      raw[offset + 2] = inBlock ? 240 : 40;
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

/** La misma foto pero otra: franjas en vez de degradé. */
async function renderOther(size: number): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const channels = 3;
  const raw = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * channels;
      const stripe = Math.floor(x / 24) % 2 === 0 ? 235 : 20;
      raw[offset] = stripe;
      raw[offset + 1] = stripe;
      raw[offset + 2] = stripe;
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

describe("imagePhash — el camino real, con archivos codificados", () => {
  it("la misma foto en WebP y en JPEG de baja calidad sigue siendo la misma", async () => {
    const { default: sharp } = await import("sharp");
    const source = await renderPhoto(512);

    const webp = await sharp(source).webp({ quality: 82 }).toBuffer();
    // Reescalada a la mitad y comprimida fuerte: el peor caso realista.
    const jpeg = await sharp(source).resize(256, 256).jpeg({ quality: 35 }).toBuffer();

    const a = await imagePhash(new Uint8Array(webp));
    const b = await imagePhash(new Uint8Array(jpeg));

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(hammingDistance(a!, b!)).toBeLessThanOrEqual(DEFAULT_MAX_DISTANCE);
  });

  it("dos fotos distintas NO se confunden", async () => {
    const a = await imagePhash(new Uint8Array(await renderPhoto(512)));
    const b = await imagePhash(new Uint8Array(await renderOther(512)));
    expect(hammingDistance(a!, b!)).toBeGreaterThan(DEFAULT_MAX_DISTANCE);
  });

  it("un archivo que no es una imagen devuelve null en vez de lanzar", async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    await expect(imagePhash(garbage)).resolves.toBeNull();
  });
});
