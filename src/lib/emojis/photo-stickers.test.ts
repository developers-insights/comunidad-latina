import { describe, expect, it } from "vitest";
import {
  MAX_STICKERS,
  normalizeStickers,
  stickerBox,
  stickerImageUrls,
  type PhotoSticker,
} from "@/lib/media/photo-overlay";

/**
 * LO QUE LA 0125 LE AGREGÓ AL STICKER: que pueda ser una IMAGEN y no un glifo.
 *
 * Vive en `lib/emojis` y no junto a `photo-overlay.test.ts` porque es la parte
 * que trajo esta feature; lo de siempre (posición, tamaño, recorte) ya está
 * cubierto allá y no cambió.
 *
 * Lo que se protege acá es que un emoji de imagen se comporte EXACTAMENTE
 * igual que uno de texto en todo lo que no sea pintar: si `stickerBox` diera
 * otro número para uno de imagen, el dibujo quedaría en un lugar en la vista
 * previa y en otro en la foto publicada — irreversible, porque el archivo ya se
 * subió con el emoji quemado adentro.
 */

function sticker(over: Partial<PhotoSticker> = {}): PhotoSticker {
  return { id: "s-1", emoji: "🔥", x: 0.5, y: 0.5, size: 0.2, ...over };
}

function imagen(over: Partial<PhotoSticker> = {}): PhotoSticker {
  return sticker({
    emoji: "",
    image: { slug: "klk", url: "https://cdn.test/klk.png", alt: "Saludo con la mano" },
    ...over,
  });
}

describe("stickerImageUrls", () => {
  it("sin emojis de imagen no hay nada que descargar", () => {
    expect(stickerImageUrls([sticker(), sticker({ id: "s-2", emoji: "❤️" })])).toEqual([]);
  });

  it("el mismo dibujo puesto tres veces es UNA sola descarga", () => {
    const urls = stickerImageUrls([
      imagen({ id: "a" }),
      imagen({ id: "b" }),
      imagen({ id: "c" }),
    ]);
    expect(urls).toEqual(["https://cdn.test/klk.png"]);
  });

  it("mezcla de glifos e imágenes: sólo vuelven las imágenes", () => {
    const urls = stickerImageUrls([
      sticker(),
      imagen({ id: "b" }),
      imagen({ id: "c", image: { slug: "x", url: "https://cdn.test/x.png", alt: "Otro dibujo" } }),
    ]);
    expect(urls).toEqual(["https://cdn.test/klk.png", "https://cdn.test/x.png"]);
  });
});

describe("normalizeStickers con emojis de imagen", () => {
  it("conserva `image` intacto: sin eso el horneado no sabría qué dibujar", () => {
    const [normalizado] = normalizeStickers([imagen()]);
    expect(normalizado!.image).toEqual({
      slug: "klk",
      url: "https://cdn.test/klk.png",
      alt: "Saludo con la mano",
    });
  });

  it("descarta lo que no tiene NI glifo NI imagen: no puede gastar uno de los ocho lugares", () => {
    expect(normalizeStickers([sticker({ emoji: "  " })])).toEqual([]);
    expect(normalizeStickers([sticker({ emoji: "" })])).toEqual([]);
  });

  it("filtra ANTES de cortar en MAX_STICKERS: el cupo lo gastan los que se ven", () => {
    const vacios = Array.from({ length: 5 }, (_, i) => sticker({ id: `v${i}`, emoji: "" }));
    const buenos = Array.from({ length: MAX_STICKERS }, (_, i) => imagen({ id: `b${i}` }));
    expect(normalizeStickers([...vacios, ...buenos])).toHaveLength(MAX_STICKERS);
  });

  it("sigue recortando posición y tamaño igual que un glifo", () => {
    const [normalizado] = normalizeStickers([imagen({ x: 4, y: -2, size: 99 })]);
    expect(normalizado!.x).toBe(1);
    expect(normalizado!.y).toBe(0);
    expect(normalizado!.size).toBeLessThanOrEqual(0.6);
  });
});

describe("stickerBox no distingue glifo de imagen", () => {
  it("misma posición y mismo tamaño para los dos", () => {
    const caja = { width: 800, height: 1000 };
    const conGlifo = stickerBox(sticker({ x: 0.25, y: 0.75, size: 0.2 }), caja);
    const conImagen = stickerBox(imagen({ x: 0.25, y: 0.75, size: 0.2 }), caja);
    expect(conImagen).toEqual(conGlifo);
  });

  it("la cuenta escala con el recuadro: la vista previa y el canvas coinciden", () => {
    const chico = stickerBox(imagen({ x: 0.3, y: 0.6 }), { width: 375, height: 469 });
    const grande = stickerBox(imagen({ x: 0.3, y: 0.6 }), { width: 1600, height: 2000 });
    expect(grande.centerX / grande.fontSize).toBeCloseTo(chico.centerX / chico.fontSize, 1);
  });
});
