import { clampChroma, formatHex, oklch, wcagContrast } from "culori";

/**
 * Brand color pipeline (§2.3 del design brief) — determinístico y puro.
 *
 * El admin de tenant entrega UN hex. Ese hex nunca se usa directo en la UI:
 *  1. Se convierte a OKLCH y se genera una escala tonal 50–900 con una escalera
 *     de lightness FIJA (hue y chroma vienen del hex; chroma clampeado para que
 *     un verde neón no vibre).
 *  2. El tono de CTA se valida contra blanco y contra el neutro más oscuro
 *     (WCAG AA ≥ 4.5:1) y se ajusta la lightness hasta cumplir. El admin nunca
 *     puede forzar un color que rompa contraste.
 */

export const BRAND_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type BrandStep = (typeof BRAND_STEPS)[number];

/** Escalera de lightness fija — igual para todos los tenants: garantiza familia visual. */
const LIGHTNESS: Record<BrandStep, number> = {
  50: 0.975,
  100: 0.94,
  200: 0.885,
  300: 0.81,
  400: 0.72,
  500: 0.63,
  600: 0.55,
  700: 0.47,
  800: 0.4,
  900: 0.33,
};

/** Curva de chroma: los extremos se desaturan para no vibrar sobre la base neutra. */
const CHROMA_FACTOR: Record<BrandStep, number> = {
  50: 0.12,
  100: 0.25,
  200: 0.45,
  300: 0.7,
  400: 0.9,
  500: 1,
  600: 1,
  700: 0.92,
  800: 0.8,
  900: 0.65,
};

/** Clamp global de chroma en la escala — "regla anti-fealdad" del brief. */
const MAX_SCALE_CHROMA = 0.15;
/** El CTA tolera un poco más de chroma que la escala (es EL acento de marca). */
const MAX_CTA_CHROMA = 0.19;

const FALLBACK_HEX = "#1A5EDB";
const WHITE = "#FFFFFF";
/** --neutral-950 del brief: el texto oscuro del design system, no #000. */
const NEUTRAL_950 = "#0D0C08";
const WCAG_AA = 4.5;
const MIN_CTA_LIGHTNESS = 0.18;

type OklchColor = { mode: "oklch"; l: number; c: number; h?: number };

export interface BrandTheme {
  /** Escala tonal 50–900 en hex, lista para --color-brand-N. */
  scale: Record<BrandStep, string>;
  /** Tono de CTA/texto de marca, contraste AA garantizado con `brandForeground`. */
  brand: string;
  /** Color de texto sobre `brand`: blanco o el neutro más oscuro, según contraste. */
  brandForeground: string;
}

function parseBrand(hex: string): OklchColor {
  const parsed = oklch(hex) ?? oklch(FALLBACK_HEX)!;
  return {
    mode: "oklch",
    l: parsed.l ?? 0.55,
    c: parsed.c ?? 0.1,
    h: parsed.h,
  };
}

function toHex(color: OklchColor): string {
  return formatHex(clampChroma(color, "oklch"));
}

function ensureCtaContrast(base: OklchColor): { brand: string; foreground: string } {
  let candidate: OklchColor = { ...base, c: Math.min(base.c, MAX_CTA_CHROMA) };

  const vsWhite = wcagContrast(toHex(candidate), WHITE);
  const vsDark = wcagContrast(toHex(candidate), NEUTRAL_950);

  // El color ya funciona con texto blanco o con texto oscuro → se respeta tal cual
  // (un verde neón queda como CTA neón con texto casi-negro, sobre base neutra impecable).
  if (vsWhite >= WCAG_AA) return { brand: toHex(candidate), foreground: WHITE };
  if (vsDark >= WCAG_AA) return { brand: toHex(candidate), foreground: NEUTRAL_950 };

  // Zona media (no contrasta con nada): se oscurece determinísticamente hasta AA vs blanco.
  while (candidate.l > MIN_CTA_LIGHTNESS && wcagContrast(toHex(candidate), WHITE) < WCAG_AA) {
    candidate = { ...candidate, l: candidate.l - 0.01 };
  }
  return { brand: toHex(candidate), foreground: WHITE };
}

/** Genera el tema de marca completo a partir de un hex. Pura y determinística. */
export function buildBrandScale(hex: string): BrandTheme {
  const base = parseBrand(hex);

  const scale = {} as Record<BrandStep, string>;
  for (const step of BRAND_STEPS) {
    scale[step] = toHex({
      mode: "oklch",
      l: LIGHTNESS[step],
      c: Math.min(base.c * CHROMA_FACTOR[step], MAX_SCALE_CHROMA),
      h: base.h,
    });
  }

  const { brand, foreground } = ensureCtaContrast(base);
  return { scale, brand, brandForeground: foreground };
}

/**
 * Tema de marca como CSS custom properties, listo para inyectar como inline
 * style en el layout: { '--color-brand-50': …, '--color-brand': …, … }.
 */
export function brandThemeToStyle(hex: string): Record<string, string> {
  const theme = buildBrandScale(hex);
  const style: Record<string, string> = {};
  for (const step of BRAND_STEPS) {
    style[`--color-brand-${step}`] = theme.scale[step];
  }
  style["--color-brand"] = theme.brand;
  style["--color-brand-foreground"] = theme.brandForeground;
  return style;
}
