import { describe, expect, it } from "vitest";
import { wcagContrast } from "culori";
import { BRAND_STEPS, brandThemeToStyle, buildBrandScale } from "./brand-pipeline";

const HEX_RE = /^#[0-9a-f]{6}$/;
const UGLY_INPUTS = ["#39FF14", "#FFFF00", "#FF00FF", "#7A7364", "#000000", "#FFFFFF"];

describe("buildBrandScale", () => {
  it("genera la escala completa 50–900 en hex válido", () => {
    const theme = buildBrandScale("#1A5EDB");
    expect(Object.keys(theme.scale)).toHaveLength(BRAND_STEPS.length);
    for (const step of BRAND_STEPS) {
      expect(theme.scale[step]).toMatch(HEX_RE);
    }
  });

  it.each(UGLY_INPUTS)("garantiza contraste AA (≥4.5:1) del CTA para %s", (hex) => {
    const theme = buildBrandScale(hex);
    expect(wcagContrast(theme.brand, theme.brandForeground)).toBeGreaterThanOrEqual(4.5);
  });

  it("un hex feo tipo verde neón produce un par CTA/foreground usable", () => {
    const theme = buildBrandScale("#39FF14");
    expect(theme.brand).toMatch(HEX_RE);
    expect(["#ffffff", "#0d0c08"]).toContain(theme.brandForeground.toLowerCase());
  });

  it("es determinístico: mismo input, mismo output", () => {
    expect(buildBrandScale("#C2410C")).toEqual(buildBrandScale("#C2410C"));
  });

  it("no lanza con input inválido — cae al azul de fallback", () => {
    const theme = buildBrandScale("papaya con tajada");
    expect(theme.brand).toMatch(HEX_RE);
    expect(wcagContrast(theme.brand, theme.brandForeground)).toBeGreaterThanOrEqual(4.5);
  });

  it("la escala mantiene lightness descendente (50 más claro que 900)", () => {
    const theme = buildBrandScale("#1A5EDB");
    const luminance = (hex: string) => wcagContrast(hex, "#000000");
    expect(luminance(theme.scale[50])).toBeGreaterThan(luminance(theme.scale[500]));
    expect(luminance(theme.scale[500])).toBeGreaterThan(luminance(theme.scale[900]));
  });
});

describe("brandThemeToStyle", () => {
  it("devuelve todas las custom properties de marca", () => {
    const style = brandThemeToStyle("#1A5EDB");
    for (const step of BRAND_STEPS) {
      expect(style[`--color-brand-${step}`]).toMatch(HEX_RE);
    }
    expect(style["--color-brand"]).toMatch(HEX_RE);
    expect(style["--color-brand-foreground"]).toBeTruthy();
  });
});
