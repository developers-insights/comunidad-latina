import { describe, expect, it } from "vitest";
import { oklch, wcagContrast } from "culori";
import { BRAND_STEPS, brandThemeToStyle, buildBrandScale } from "./brand-pipeline";

const HEX_RE = /^#[0-9a-f]{6}$/;
const UGLY_INPUTS = ["#39FF14", "#FFFF00", "#FF00FF", "#7A7364", "#000000", "#FFFFFF"];
/** Cubre los cuadrantes peligrosos: neón, pastel, azul marino, marrón, gris. */
const TENANT_INPUTS = [
  ...UGLY_INPUTS,
  "#1A5EDB",
  "#0D2E6B",
  "#C2410C",
  "#1A7F5A",
  "#E11D48",
  "#6D28D9",
  "#00CED1",
  "#8B4513",
];

/* Anclas de globals.css. Si cambian allá, este test explota — es el punto. */
const LIGHT_SURFACE = "#FFFFFF";
const LIGHT_CANVAS = "#FCFCFB";
const DARK_CANVAS = "#17150F";
const WCAG_AA = 4.5;
const WCAG_AA_UI = 3;
/** Mismos valores que el pipeline (§2.8 + regla anti-fealdad). */
const DARK_LIGHTNESS_GAIN = 1.1;
const MAX_CTA_LIGHTNESS = 0.92;
const MAX_CTA_CHROMA = 0.19;

const lightnessOf = (hex: string) => oklch(hex)!.l ?? 0;
const chromaOf = (hex: string) => oklch(hex)!.c ?? 0;

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
    expect(wcagContrast(theme.brand, theme.brandForeground)).toBeGreaterThanOrEqual(WCAG_AA);
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
    expect(wcagContrast(theme.brand, theme.brandForeground)).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it("la escala mantiene lightness descendente (50 más claro que 900)", () => {
    const theme = buildBrandScale("#1A5EDB");
    const luminance = (hex: string) => wcagContrast(hex, "#000000");
    expect(luminance(theme.scale[50])).toBeGreaterThan(luminance(theme.scale[500]));
    expect(luminance(theme.scale[500])).toBeGreaterThan(luminance(theme.scale[900]));
  });

  it("los campos de compat apuntan al tono light", () => {
    const theme = buildBrandScale("#1A5EDB");
    expect(theme.brand).toBe(theme.light.brand);
    expect(theme.brandForeground).toBe(theme.light.foreground);
  });
});

describe("tono de marca light — simétrico al dark", () => {
  it.each(TENANT_INPUTS)("%s: el CTA light contrasta ≥3:1 contra el canvas claro", (hex) => {
    // WCAG 1.4.11. Esto NO se validaba: un tenant amarillo daba un botón de
    // 1.39:1 sobre #FCFCFB — un rectángulo invisible con un label flotando.
    const { light } = buildBrandScale(hex);
    expect(wcagContrast(light.brand, LIGHT_CANVAS)).toBeGreaterThanOrEqual(WCAG_AA_UI);
  });

  it.each(TENANT_INPUTS)("%s: el :hover light tampoco se hunde en el canvas", (hex) => {
    const { light } = buildBrandScale(hex);
    expect(wcagContrast(light.hover, LIGHT_CANVAS)).toBeGreaterThanOrEqual(WCAG_AA_UI);
  });

  it("un amarillo sólo se oscurece lo necesario, y conserva el hue", () => {
    const { light } = buildBrandScale("#FFD400");
    expect(wcagContrast(light.brand, LIGHT_CANVAS)).toBeGreaterThanOrEqual(WCAG_AA_UI);
    expect(wcagContrast(light.brand, light.foreground)).toBeGreaterThanOrEqual(WCAG_AA);
    // El hue del amarillo original sobrevive (±3°): se baja L, no se cambia el color.
    expect(Math.abs((oklch(light.brand)!.h ?? 0) - (oklch("#FFD400")!.h ?? 0))).toBeLessThan(3);
  });

  it("los tonos medios no se mueven ni un dígito (blast radius acotado)", () => {
    // El lazo del canvas es un no-op para cualquier marca que ya fuera usable.
    expect(buildBrandScale("#C2410C").light.brand).toBe("#c2410c");
    expect(buildBrandScale("#0D2E6B").light.brand).toBe("#0d2e6b");
    expect(buildBrandScale("#1A7F5A").light.brand).toBe("#1a7f5a");
    expect(buildBrandScale("#000000").light.brand).toBe("#000000");
  });
});

describe("tono de marca dark (§2.8)", () => {
  it.each(TENANT_INPUTS)("%s: el CTA dark alcanza el +10% de L de §2.8", (hex) => {
    const { light, dark } = buildBrandScale(hex);
    // El objetivo es light·1.1, topeado: una marca casi blanca no puede "subir"
    // más, y de hecho BAJA hasta el tope para no encandilar sobre #17150F.
    const target = Math.min(lightnessOf(light.brand) * DARK_LIGHTNESS_GAIN, MAX_CTA_LIGHTNESS);
    expect(lightnessOf(dark.brand)).toBeGreaterThanOrEqual(target - 0.02);
  });

  it.each(TENANT_INPUTS)("%s: el CTA dark nunca supera el tope de chroma", (hex) => {
    // "…y se desatura ligeramente": el chroma jamás pasa el techo del CTA (0.19),
    // y el pipeline además lo amortigua 12% antes de clampearlo al gamut.
    const { dark } = buildBrandScale(hex);
    expect(chromaOf(dark.brand)).toBeLessThanOrEqual(MAX_CTA_CHROMA + 0.005);
  });

  it("un azul marino, invisible sobre el canvas oscuro, se aclara de verdad", () => {
    const { light, dark } = buildBrandScale("#0D2E6B");
    expect(wcagContrast(light.brand, DARK_CANVAS)).toBeLessThan(WCAG_AA_UI); // el bug viejo
    expect(lightnessOf(dark.brand)).toBeGreaterThan(lightnessOf(light.brand) + 0.1);
  });

  it.each(TENANT_INPUTS)("%s: el CTA dark contrasta ≥3:1 contra el canvas oscuro", (hex) => {
    const { dark } = buildBrandScale(hex);
    // Esto es lo que NO se validaba: un azul marino era un botón invisible.
    expect(wcagContrast(dark.brand, DARK_CANVAS)).toBeGreaterThanOrEqual(WCAG_AA_UI);
  });

  it.each(TENANT_INPUTS)("%s: el label sobre el CTA es AA en los dos temas", (hex) => {
    const { light, dark } = buildBrandScale(hex);
    expect(wcagContrast(light.brand, light.foreground)).toBeGreaterThanOrEqual(WCAG_AA);
    expect(wcagContrast(dark.brand, dark.foreground)).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it.each(TENANT_INPUTS)("%s: el :hover del CTA no rompe el AA del label", (hex) => {
    const { light, dark } = buildBrandScale(hex);
    expect(wcagContrast(light.hover, light.foreground)).toBeGreaterThanOrEqual(WCAG_AA);
    expect(wcagContrast(dark.hover, dark.foreground)).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it.each(TENANT_INPUTS)("%s: el :hover se distingue del estado de reposo", (hex) => {
    const { light, dark } = buildBrandScale(hex);
    expect(light.hover).not.toBe(light.brand);
    expect(dark.hover).not.toBe(dark.brand);
  });

  it.each(TENANT_INPUTS)("%s: brand-ink es texto AA sobre su fondo más claro", (hex) => {
    const { light, dark } = buildBrandScale(hex);
    // light: el fondo más claro sobre el que puede caer es la superficie blanca.
    expect(wcagContrast(light.ink, LIGHT_SURFACE)).toBeGreaterThanOrEqual(WCAG_AA);
    // dark: el fondo más claro es el propio brand-tint (chips, avatares).
    expect(wcagContrast(dark.ink, dark.tint)).toBeGreaterThanOrEqual(WCAG_AA);
    expect(wcagContrast(dark.ink, DARK_CANVAS)).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it.each(TENANT_INPUTS)("%s: brand-ink es AA también sobre brand-tint en light", (hex) => {
    const { light } = buildBrandScale(hex);
    expect(wcagContrast(light.ink, light.tint)).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it("el tint light es el escalón 50 y el dark es oscuro de verdad", () => {
    const theme = buildBrandScale("#1A5EDB");
    expect(theme.light.tint).toBe(theme.scale[50]);
    expect(wcagContrast(theme.dark.tint, "#FFFFFF")).toBeGreaterThan(WCAG_AA);
  });

  it("es determinístico también en los tonos nuevos", () => {
    expect(buildBrandScale("#6D28D9").dark).toEqual(buildBrandScale("#6D28D9").dark);
  });
});

describe("brandThemeToStyle", () => {
  it("devuelve la escala completa y los dos juegos de tonos", () => {
    const style = brandThemeToStyle("#1A5EDB");
    for (const step of BRAND_STEPS) {
      expect(style[`--color-brand-${step}`]).toMatch(HEX_RE);
    }
    for (const theme of ["light", "dark"] as const) {
      expect(style[`--brand-${theme}`]).toMatch(HEX_RE);
      expect(style[`--brand-${theme}-foreground`]).toBeTruthy();
      expect(style[`--brand-${theme}-hover`]).toMatch(HEX_RE);
      expect(style[`--brand-${theme}-ink`]).toMatch(HEX_RE);
      expect(style[`--brand-${theme}-tint`]).toMatch(HEX_RE);
    }
  });

  it("NO emite --color-brand ni --color-brand-foreground", () => {
    // Un inline style en <html> gana por cascada sobre cualquier regla de autor:
    // si el pipeline los emitiera, el CTA quedaría congelado en su tono light y
    // el tema oscuro nunca lo alcanzaría. Los define globals.css desde --cl-brand.
    const style = brandThemeToStyle("#1A5EDB");
    expect(style["--color-brand"]).toBeUndefined();
    expect(style["--color-brand-foreground"]).toBeUndefined();
  });

  it("coincide con buildBrandScale (misma función pura)", () => {
    const theme = buildBrandScale("#C2410C");
    const style = brandThemeToStyle("#C2410C");
    expect(style["--brand-light"]).toBe(theme.light.brand);
    expect(style["--brand-dark-ink"]).toBe(theme.dark.ink);
  });
});
