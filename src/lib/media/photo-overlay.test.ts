import { describe, expect, it } from "vitest";
import {
  CAPTION_COLORS,
  CAPTION_FONTS,
  CAPTION_FONT_LIST,
  DEFAULT_CAPTION_COLOR,
  DEFAULT_CAPTION_FONT,
  DEFAULT_STICKER_SIZE,
  MAX_STICKERS,
  MAX_STICKER_SIZE,
  MIN_STICKER_SIZE,
  STICKER_GROUPS,
  captionBarFill,
  captionFontCss,
  captionFontFamilyFor,
  captionFontShorthand,
  captionHaloColor,
  clampStickerPosition,
  clampStickerSize,
  normalizeStickers,
  resolveCaptionColor,
  resolveCaptionFont,
  stickerBox,
  type PhotoSticker,
} from "./photo-overlay";

/**
 * TEXTO Y EMOJIS SOBRE LA FOTO — contratos puros.
 *
 * Lo que se prueba acá es lo que impide que la vista previa y el archivo
 * publicado digan cosas distintas: los mismos colores, la misma familia y la
 * misma cuenta de posición para el CSS y para el canvas. Como el horneado es
 * irreversible, una diferencia entre los dos sólo se descubre mirando la
 * publicación.
 */

function sticker(over: Partial<PhotoSticker> = {}): PhotoSticker {
  return { id: "s", emoji: "🔥", x: 0.5, y: 0.5, size: DEFAULT_STICKER_SIZE, ...over };
}

describe("colores del texto", () => {
  it("el default sigue siendo el blanco que ya se quemaba (una edición vieja no cambia)", () => {
    expect(DEFAULT_CAPTION_COLOR).toBe("blanco");
    expect(resolveCaptionColor(DEFAULT_CAPTION_COLOR).fill).toBe("#f7f6f3");
  });

  it("un id desconocido cae en el default en vez de devolver undefined", () => {
    expect(resolveCaptionColor("fucsia-neon" as never).id).toBe(DEFAULT_CAPTION_COLOR);
    expect(resolveCaptionColor(null).id).toBe(DEFAULT_CAPTION_COLOR);
  });

  it("todos los del catálogo se resuelven y traen nombre en pantalla", () => {
    for (const id of CAPTION_COLORS) {
      const color = resolveCaptionColor(id);
      expect(color.id).toBe(id);
      expect(color.label.length).toBeGreaterThan(0);
      expect(color.fill).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("la barra es SIEMPRE la contraria a la tinta — o el texto no se lee", () => {
    // Sin esto, elegir negro con fondo daba tinta casi negra sobre barra casi
    // negra: un control que ofrece volverse ilegible.
    expect(captionBarFill(resolveCaptionColor("negro"))).toBe("rgba(247, 246, 243, 0.72)");
    expect(captionBarFill(resolveCaptionColor("blanco"))).toBe("rgba(13, 12, 8, 0.55)");
  });

  it("el halo también invierte: sin barra, la legibilidad la da el contraste", () => {
    expect(captionHaloColor(resolveCaptionColor("negro"))).toContain("255, 255, 255");
    expect(captionHaloColor(resolveCaptionColor("amarillo"))).toContain("0, 0, 0");
  });

  it("los valores del blanco no cambiaron: son los que quemaba bake-photo antes de la paleta", () => {
    expect(captionBarFill(resolveCaptionColor("blanco"))).toBe("rgba(13, 12, 8, 0.55)");
    expect(captionHaloColor(resolveCaptionColor("blanco"))).toBe("rgba(0, 0, 0, 0.9)");
  });
});

describe("tipografías del texto", () => {
  it("ninguna se baja por red: o la carga la app, o está en el sistema", () => {
    // Es la regla que impide que el canvas dibuje con la de respaldo sin
    // avisar por una fuente que todavía estaba viajando.
    for (const font of CAPTION_FONT_LIST) {
      if (font.cssVar) {
        expect(["--font-general-sans", "--font-jakarta"]).toContain(font.cssVar);
      } else {
        expect(font.fallback.length).toBeGreaterThan(0);
      }
    }
  });

  it("un id desconocido cae en el default", () => {
    expect(resolveCaptionFont("comic" as never).id).toBe(DEFAULT_CAPTION_FONT);
  });

  it("para CSS se escribe var(--…): la cascada lo resuelve", () => {
    expect(captionFontCss("titular")).toContain("var(--font-general-sans)");
    expect(captionFontCss("redonda")).toContain("var(--font-jakarta)");
  });

  it("para CANVAS se inyecta el valor resuelto: ctx.font no entiende var(--…)", () => {
    const family = captionFontFamilyFor("titular", () => "__GeneralSans_abc");
    expect(family).toContain("__GeneralSans_abc");
    expect(family).not.toContain("var(");
  });

  it("sin variable resuelta (SSR, hoja sin aplicar) queda el respaldo solo, no 'var(--x)'", () => {
    const family = captionFontFamilyFor("redonda", () => "");
    expect(family).not.toContain("var(");
    expect(family).toContain("system-ui");
  });

  it("las familias del sistema no consultan ninguna variable", () => {
    const spy = { calls: 0 };
    const family = captionFontFamilyFor("clasica", () => {
      spy.calls += 1;
      return "x";
    });
    expect(spy.calls).toBe(0);
    expect(family).toContain("Georgia");
  });

  it("el shorthand de ctx.font lleva peso, tamaño en px y familia, en ese orden", () => {
    expect(captionFontShorthand("clasica", 42, () => "")).toBe(
      `700 42px ${resolveCaptionFont("clasica").fallback}`,
    );
  });

  it("un tamaño fraccionario se redondea: ctx.font con decimales raros es un dolor de cabeza", () => {
    expect(captionFontShorthand("clasica", 41.6, () => "")).toContain("42px");
  });

  it("el catálogo no está vacío ni tiene ids repetidos", () => {
    expect(CAPTION_FONTS.length).toBeGreaterThan(1);
    expect(new Set(CAPTION_FONTS).size).toBe(CAPTION_FONTS.length);
  });
});

describe("emojis: recortes", () => {
  it("el tamaño queda entre el mínimo y el máximo", () => {
    expect(clampStickerSize(0.001)).toBe(MIN_STICKER_SIZE);
    expect(clampStickerSize(9)).toBe(MAX_STICKER_SIZE);
    expect(clampStickerSize(Number.NaN)).toBe(DEFAULT_STICKER_SIZE);
  });

  it("el centro nunca sale del recuadro (si saliera, el emoji desaparecería al publicar)", () => {
    expect(clampStickerPosition(-3, 4)).toEqual({ x: 0, y: 1 });
    expect(clampStickerPosition(Number.NaN, 0.3)).toEqual({ x: 0.5, y: 0.3 });
  });

  it("normalizeStickers corta en MAX_STICKERS", () => {
    const muchos = Array.from({ length: 30 }, (_, i) => sticker({ id: `s${i}` }));
    expect(normalizeStickers(muchos)).toHaveLength(MAX_STICKERS);
  });

  it("una lista vacía o ausente devuelve un array vacío, nunca undefined", () => {
    expect(normalizeStickers(null)).toEqual([]);
    expect(normalizeStickers(undefined)).toEqual([]);
    expect(normalizeStickers([])).toEqual([]);
  });
});

describe("stickerBox — la MISMA cuenta para la pantalla y para el canvas", () => {
  it("el centro es la fracción del recuadro", () => {
    const box = stickerBox(sticker({ x: 0.25, y: 0.75 }), { width: 800, height: 1000 });
    expect(box.centerX).toBe(200);
    expect(box.centerY).toBe(750);
  });

  it("el tamaño se mide contra el LADO CORTO, no contra el ancho", () => {
    // Contra el ancho, el mismo 20% sería un emoji chico en vertical y enorme
    // en panorámica: "20%" tiene que significar lo mismo en las dos.
    const vertical = stickerBox(sticker({ size: 0.2 }), { width: 800, height: 1000 });
    const apaisado = stickerBox(sticker({ size: 0.2 }), { width: 1000, height: 800 });
    expect(vertical.fontSize).toBe(160);
    expect(apaisado.fontSize).toBe(160);
  });

  it("un recuadro chiquito no produce un tamaño 0 (fillText con 0px no dibuja)", () => {
    expect(stickerBox(sticker({ size: MIN_STICKER_SIZE }), { width: 4, height: 4 }).fontSize)
      .toBeGreaterThan(0);
  });

  it("un sticker fuera de rango se normaliza ANTES de convertirse a píxeles", () => {
    const box = stickerBox(sticker({ x: 5, y: -2 }), { width: 400, height: 400 });
    expect(box.centerX).toBe(400);
    expect(box.centerY).toBe(0);
  });

  it("dos recuadros de distinto tamaño colocan el emoji en la MISMA fracción", () => {
    // Es lo que garantiza que el emoji caiga igual en la vista previa (stage de
    // 375 px) y en el archivo horneado (canvas de 1600 px).
    const chico = stickerBox(sticker({ x: 0.3, y: 0.6 }), { width: 375, height: 469 });
    const grande = stickerBox(sticker({ x: 0.3, y: 0.6 }), { width: 1600, height: 2000 });
    expect(chico.centerX / 375).toBeCloseTo(grande.centerX / 1600, 6);
    expect(chico.centerY / 469).toBeCloseTo(grande.centerY / 2000, 6);
  });
});

describe("catálogo de emojis", () => {
  it("cada grupo tiene nombre y emojis", () => {
    expect(STICKER_GROUPS.length).toBeGreaterThan(0);
    for (const group of STICKER_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.emojis.length).toBeGreaterThan(0);
    }
  });

  it("no hay emojis repetidos entre grupos: tocar dos veces el mismo lugar confunde", () => {
    const todos = STICKER_GROUPS.flatMap((group) => [...group.emojis]);
    expect(new Set(todos).size).toBe(todos.length);
  });
});
