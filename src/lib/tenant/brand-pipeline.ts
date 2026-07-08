import { clampChroma, formatHex, oklch, rgb, wcagContrast } from "culori";

/**
 * Brand color pipeline (§2.3 + §2.8 del design brief) — determinístico y puro.
 *
 * El admin de tenant entrega UN hex. Ese hex nunca se usa directo en la UI:
 *  1. Se convierte a OKLCH y se genera una escala tonal 50–900 con una escalera
 *     de lightness FIJA (hue y chroma vienen del hex; chroma clampeado para que
 *     un verde neón no vibre). La escala NO depende del tema.
 *  2. Se derivan DOS juegos de tonos de marca — uno para light, otro para dark
 *     (§2.8: "el color de marca del tenant se desatura ligeramente y sube de
 *     luminosidad (+8-12% L) en dark mode para no vibrar contra el fondo
 *     oscuro — esto es automático en el brand color pipeline, no manual").
 *  3. Cada tono se valida contra WCAG AA en SU tema: el label sobre el CTA a
 *     ≥4.5:1, el CTA como superficie contra el canvas de su tema a ≥3:1
 *     (WCAG 1.4.11, en light Y en dark), y el tono de texto (`ink`) a ≥4.5:1
 *     contra el fondo más claro sobre el que puede caer. El admin nunca puede
 *     forzar un color que rompa contraste.
 *
 * Consumo: `brandThemeToStyle()` emite ambos juegos como custom properties en
 * <html>; globals.css elige el juego según el tema activo. Los call sites
 * (`bg-brand`, `text-brand-foreground`, `var(--color-brand)`) no cambian.
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

/* ── Anclas de contraste: los fondos reales de cada tema (globals.css) ──────
   Si estos hex cambian en globals.css, cambian acá. El test de paridad de
   tokens (src/components/theme/theme-tokens.test.ts) verifica que no diverjan. */

/** --cl-light-surface: el fondo MÁS CLARO del tema light (peor caso para texto). */
const LIGHT_SURFACE = "#FFFFFF";
/** --cl-light-canvas: el fondo de página del tema light. */
const LIGHT_CANVAS = "#FCFCFB";
/** --cl-dark-canvas: el fondo de página del tema dark (§2.8, nunca #000). */
const DARK_CANVAS = "#17150F";
/** --cl-dark-surface-raised: el fondo MÁS CLARO del tema dark (peor caso para texto). */
const DARK_SURFACE_RAISED = "#2B2820";

const WCAG_AA = 4.5;
/** WCAG 1.4.11: componentes de UI y bordes que identifican un control. */
const WCAG_AA_UI = 3;

const MIN_CTA_LIGHTNESS = 0.18;
const MAX_CTA_LIGHTNESS = 0.92;
/** §2.8: la marca sube ~10% de luminosidad en dark. */
const DARK_LIGHTNESS_GAIN = 1.1;
/** §2.8: …y se desatura ~12% para no vibrar contra el fondo oscuro. */
const DARK_CHROMA_DAMP = 0.88;
/**
 * Opacidad del tint de marca en dark: el escalón 900 al 40 %.
 *
 * ⚠️ Ojo con los comentarios de este archivo: el scanner de Tailwind v4 no
 * distingue código de prosa. Escribir el nombre de una utility acá (con el
 * prefijo y la barra de opacidad) hace que Tailwind emita esa clase en el CSS de
 * producción aunque nadie la use en JSX, y mantiene vivo su `--color-*` en el
 * `:root`. Nombrar el escalón, no la clase.
 */
const TINT_ALPHA = 0.4;
/** Paso de lightness del estado :hover del CTA, de mayor a menor. */
const HOVER_STEPS = [0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02] as const;

type OklchColor = { mode: "oklch"; l: number; c: number; h?: number };

/** Un juego completo de tonos de marca para UN tema. */
export interface BrandTone {
  /** Fondo del CTA / acento sólido de marca. */
  brand: string;
  /** Texto sobre `brand` — AA ≥4.5:1 garantizado. */
  foreground: string;
  /** Fondo del CTA en `:hover` — se aleja del canvas, sin romper el AA del label. */
  hover: string;
  /** Tono de marca legible como TEXTO/ícono sobre el canvas — AA ≥4.5:1. */
  ink: string;
  /** Fondo tenue de marca (chips, avatares, bloques destacados). */
  tint: string;
}

export interface BrandTheme {
  /** Escala tonal 50–900 en hex, lista para --color-brand-N. No depende del tema. */
  scale: Record<BrandStep, string>;
  /** Tonos de marca del tema light. */
  light: BrandTone;
  /** Tonos de marca del tema dark (§2.8). */
  dark: BrandTone;
  /** Compat: alias de `light.brand`. Lo consumen el admin y los tests viejos. */
  brand: string;
  /** Compat: alias de `light.foreground`. */
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Compone `fg` con opacidad `alpha` sobre `bg` en sRGB — lo mismo que hace el navegador. */
function compositeOver(fg: string, bg: string, alpha: number): string {
  const f = rgb(fg)!;
  const b = rgb(bg)!;
  return formatHex({
    mode: "rgb",
    r: alpha * f.r + (1 - alpha) * b.r,
    g: alpha * f.g + (1 - alpha) * b.g,
    b: alpha * f.b + (1 - alpha) * b.b,
  });
}

/**
 * CTA del tema LIGHT — simétrico a `ensureCtaContrastDark`.
 *
 * 1) El fill tiene que distinguirse del canvas CLARO (WCAG 1.4.11, ≥3:1). Esto
 *    no se validaba: un tenant amarillo (#FFD400) daba un botón de 1.39:1 sobre
 *    #FCFCFB — o sea, un rectángulo invisible con un label negro flotando. Sólo
 *    se movían las marcas que ya estaban rotas: los tonos medios (#1A5EDB,
 *    #C2410C, #0D2E6B…) ya pasan 4.8–12.6:1 y el lazo es un no-op para ellos.
 * 2) Recién entonces se elige el label. El orden importa: oscurecer el fill
 *    puede volver legible un blanco que antes no lo era, y al revés.
 *
 * Oscurecer es monótono contra un fondo claro, así que el lazo siempre termina
 * (y `MIN_CTA_LIGHTNESS` es la red de seguridad, no la salida esperada).
 */
function ensureCtaContrast(base: OklchColor): { brand: string; foreground: string } {
  let candidate: OklchColor = { ...base, c: Math.min(base.c, MAX_CTA_CHROMA) };

  while (
    candidate.l > MIN_CTA_LIGHTNESS &&
    wcagContrast(toHex(candidate), LIGHT_CANVAS) < WCAG_AA_UI
  ) {
    candidate = { ...candidate, l: candidate.l - 0.01 };
  }

  if (wcagContrast(toHex(candidate), WHITE) >= WCAG_AA) {
    return { brand: toHex(candidate), foreground: WHITE };
  }
  if (wcagContrast(toHex(candidate), NEUTRAL_950) >= WCAG_AA) {
    return { brand: toHex(candidate), foreground: NEUTRAL_950 };
  }

  while (candidate.l > MIN_CTA_LIGHTNESS && wcagContrast(toHex(candidate), WHITE) < WCAG_AA) {
    candidate = { ...candidate, l: candidate.l - 0.01 };
  }
  return { brand: toHex(candidate), foreground: WHITE };
}

/**
 * CTA del tema DARK (§2.8). Sube luminosidad, desatura, y —a diferencia del
 * light— valida el fill CONTRA EL CANVAS OSCURO: un azul marino sobre #17150F
 * es un botón invisible, y hasta hoy nadie lo chequeaba.
 */
function ensureCtaContrastDark(base: OklchColor): { brand: string; foreground: string } {
  let candidate: OklchColor = {
    ...base,
    c: Math.min(base.c * DARK_CHROMA_DAMP, MAX_CTA_CHROMA),
    l: clamp(base.l * DARK_LIGHTNESS_GAIN, MIN_CTA_LIGHTNESS, MAX_CTA_LIGHTNESS),
  };

  // 1) El botón tiene que distinguirse del canvas oscuro (WCAG 1.4.11, ≥3:1).
  while (
    candidate.l < MAX_CTA_LIGHTNESS &&
    wcagContrast(toHex(candidate), DARK_CANVAS) < WCAG_AA_UI
  ) {
    candidate = { ...candidate, l: candidate.l + 0.01 };
  }

  // 2) El label encima tiene que ser AA. Blanco primero (paridad con light);
  //    si no llega, se aclara hasta que el neutro oscuro sí llegue (monótono).
  if (wcagContrast(toHex(candidate), WHITE) >= WCAG_AA) {
    return { brand: toHex(candidate), foreground: WHITE };
  }
  while (
    candidate.l < MAX_CTA_LIGHTNESS &&
    wcagContrast(toHex(candidate), NEUTRAL_950) < WCAG_AA
  ) {
    candidate = { ...candidate, l: candidate.l + 0.01 };
  }
  return { brand: toHex(candidate), foreground: NEUTRAL_950 };
}

/**
 * Estado `:hover` del CTA: se aleja del canvas (más oscuro en light, más claro
 * en dark). Si esa dirección rompe el AA del label o hunde el fill contra el
 * canvas, prueba la dirección opuesta; si ninguna sirve, no hay hover (devuelve
 * el mismo tono). Nunca degrada el contraste que ya tenía el estado de reposo.
 */
function hoverTone(brandHex: string, foreground: string, canvas: string): string {
  const base = parseBrand(brandHex);
  const uiFloor = Math.min(WCAG_AA_UI, wcagContrast(brandHex, canvas));
  // Alejarse del canvas: en light el canvas es claro → oscurecer; en dark, aclarar.
  const away = wcagContrast(canvas, WHITE) < wcagContrast(canvas, NEUTRAL_950) ? -1 : 1;

  for (const direction of [away, -away]) {
    for (const delta of HOVER_STEPS) {
      const candidate = toHex({
        ...base,
        l: clamp(base.l + direction * delta, MIN_CTA_LIGHTNESS, MAX_CTA_LIGHTNESS),
      });
      if (candidate === brandHex) continue;
      if (
        wcagContrast(candidate, foreground) >= WCAG_AA &&
        wcagContrast(candidate, canvas) >= uiFloor
      ) {
        return candidate;
      }
    }
  }
  return brandHex;
}

/**
 * Tono de marca para TEXTO. Arranca en el escalón de la escala que corresponde
 * al tema (700 en light, 300 en dark) y se mueve —oscureciendo en light,
 * aclarando en dark— hasta llegar a AA contra el fondo más claro sobre el que
 * puede caer (`bg`).
 */
function inkTone(base: OklchColor, step: BrandStep, bg: string, direction: 1 | -1): string {
  let candidate: OklchColor = {
    mode: "oklch",
    l: LIGHTNESS[step],
    c: Math.min(base.c * CHROMA_FACTOR[step], MAX_SCALE_CHROMA),
    h: base.h,
  };
  const limit = direction === 1 ? 0.97 : MIN_CTA_LIGHTNESS;

  while (
    (direction === 1 ? candidate.l < limit : candidate.l > limit) &&
    wcagContrast(toHex(candidate), bg) < WCAG_AA
  ) {
    candidate = { ...candidate, l: candidate.l + direction * 0.01 };
  }
  return toHex(candidate);
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

  const lightCta = ensureCtaContrast(base);
  const darkCta = ensureCtaContrastDark(base);

  // El tint en dark es brand-900 al 40% sobre la superficie más elevada: es el
  // fondo más CLARO sobre el que puede aparecer `text-brand-ink` en dark.
  const darkTint = compositeOver(scale[900], DARK_SURFACE_RAISED, TINT_ALPHA);

  const light: BrandTone = {
    brand: lightCta.brand,
    foreground: lightCta.foreground,
    hover: hoverTone(lightCta.brand, lightCta.foreground, LIGHT_CANVAS),
    ink: inkTone(base, 700, LIGHT_SURFACE, -1),
    tint: scale[50],
  };

  const dark: BrandTone = {
    brand: darkCta.brand,
    foreground: darkCta.foreground,
    hover: hoverTone(darkCta.brand, darkCta.foreground, DARK_CANVAS),
    ink: inkTone(base, 300, darkTint, 1),
    tint: darkTint,
  };

  return { scale, light, dark, brand: light.brand, brandForeground: light.foreground };
}

/**
 * Tema de marca como CSS custom properties, listo para inyectar como inline
 * style en el ROOT layout (y sólo ahí).
 *
 * ⚠️ NO emite `--color-brand` ni `--color-brand-foreground`: esos dos los define
 * globals.css a partir del tema activo (`var(--cl-brand)`). Un inline style
 * ganaría siempre por cascada y dejaría el CTA congelado en su tono light.
 */
export function brandThemeToStyle(hex: string): Record<string, string> {
  const theme = buildBrandScale(hex);
  const style: Record<string, string> = {};

  for (const step of BRAND_STEPS) {
    style[`--color-brand-${step}`] = theme.scale[step];
  }

  for (const [name, tone] of [
    ["light", theme.light],
    ["dark", theme.dark],
  ] as const) {
    style[`--brand-${name}`] = tone.brand;
    style[`--brand-${name}-foreground`] = tone.foreground;
    style[`--brand-${name}-hover`] = tone.hover;
    style[`--brand-${name}-ink`] = tone.ink;
    style[`--brand-${name}-tint`] = tone.tint;
  }

  return style;
}
