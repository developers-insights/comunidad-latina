import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wcagContrast } from "culori";
import { describe, expect, it } from "vitest";
import { buildBrandScale } from "@/lib/tenant/brand-pipeline";

/**
 * LA MATRIZ DE CONTRASTE (defecto [11], segunda mitad).
 *
 * Hoy alguien puede mover un token de `globals.css` y romper AA sin que nada se
 * queje: los ratios viven en comentarios, y un comentario no falla un build.
 * Acá se miden de verdad, con culori, resolviendo las cadenas de `var()` desde
 * el CSS real — no desde hexes copiados a mano, que es como los comentarios se
 * vuelven mentira.
 *
 * Dos mitades:
 *   1. Los tokens que NO dependen del tenant (`globals.css`), en light y en dark.
 *   2. Los que SÍ (`brand-pipeline.ts`), contra una tabla de hexes adversarios:
 *      un tenant no elige su marca para que nos cierre la matriz.
 *
 * ═══ POR QUÉ `border`, `border-subtle` Y `border-strong` NO SE TESTEAN A 3:1 ═══
 * Medidos contra `bg-surface` en light dan 1.33:1, 1.17:1 y 1.76:1. Parecen un
 * fallo de WCAG 1.4.11 y no lo son: son HAIRLINES DECORATIVOS. El 1.4.11 le pide
 * 3:1 a los objetos gráficos que IDENTIFICAN un componente o su estado, y ninguno
 * de los tres lo hace: separan una card de su fondo. No dicen "esto está
 * seleccionado", ni "esto es un control", ni "esto tiene foco".
 *
 * El afford accesible de esta app es el ANILLO DE FOCO (3px, `--shadow-focus-ring`),
 * que sí se valida acá abajo a ≥3:1 contra canvas y surface. El brief §2.8
 * prescribe `neutral-200` para el hairline, y la objeción ya fue refutada en un
 * review adversarial.
 *
 * Cuando un borde SÍ es el único diferenciador de un estado —la solicitud
 * pendiente recibida de `mensajes/page.tsx`— no se usa `border-*` ni
 * `border-brand-subtle` (1.59:1 light / 2.07:1 dark): va `border-brand-strong`,
 * y ése sí se testea a 3:1, acá y contra los 12 tenants adversarios.
 *
 * O sea: no están "sin cubrir". Están cubiertos por la regla de al lado. Si vas a
 * "arreglarlos", subir el hairline oscurece toda la app para tapar un fallo que
 * no existe.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GLOBALS = readFileSync(resolve(HERE, "../app/globals.css"), "utf8");
/** Los comentarios traen hexes y nombres de token: fuera antes de parsear. */
const CSS = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, "");

const AA = 4.5; // WCAG 1.4.3 — texto
const UI = 3; // WCAG 1.4.11 — objeto gráfico / borde que identifica un estado

/* ───────────────── parseo de globals.css y resolución de var() ─────────────────
 *
 * Deliberadamente independiente de `components/theme/theme-tokens.test.ts`: si
 * los dos compartieran helper, un bug en el helper haría pasar a los dos.
 */

function declaraciones(bloque: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const chunk of bloque.split(";")) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+)$/i.exec(chunk);
    if (m) out.set(m[1], m[2].replace(/\s+/g, " ").trim());
  }
  return out;
}

function bloque(patron: RegExp): string {
  const m = patron.exec(CSS);
  expect(m, `no encontré el bloque ${patron}`).not.toBeNull();
  return m![1];
}

/** Parte `a, b` por la coma de nivel 0 (la de `var(--x, fallback)`). */
function partirEnComa(valor: string): [string, string | null] {
  let prof = 0;
  for (let i = 0; i < valor.length; i++) {
    if (valor[i] === "(") prof++;
    else if (valor[i] === ")") prof--;
    else if (valor[i] === "," && prof === 0) return [valor.slice(0, i), valor.slice(i + 1)];
  }
  return [valor, null];
}

/**
 * Resuelve `var(--a, var(--b))` hasta el literal, igual que el navegador: manda
 * el scope, y si el token no existe se cae al fallback. Sin el inline style del
 * tenant, la marca resuelve a los escalones default de `@theme` — que es justo
 * el peor caso que queremos anclar.
 */
function resolver(valor: string, scope: Map<string, string>, prof = 0): string {
  const t = valor.trim();
  if (prof > 30) throw new Error(`ciclo de var() resolviendo ${valor}`);
  if (!t.startsWith("var(")) return t;
  const dentro = t.slice(4, t.lastIndexOf(")"));
  const [nombre, fallback] = partirEnComa(dentro);
  const clave = nombre.trim();
  if (scope.has(clave)) return resolver(scope.get(clave)!, scope, prof + 1);
  if (fallback !== null) return resolver(fallback, scope, prof + 1);
  throw new Error(`${clave} no está definido y no tiene fallback`);
}

const theme = declaraciones(bloque(/^@theme \{([\s\S]*?)^\}/m));
const themeInline = declaraciones(bloque(/^@theme inline \{([\s\S]*?)^\}/m));
const root = declaraciones(bloque(/^:root \{([\s\S]*?)^\}/m));
const darkClass = declaraciones(bloque(/^\.dark \{([\s\S]*?)^\}/m));

const fusionar = (...maps: Map<string, string>[]) => new Map(maps.flatMap((m) => [...m]));
const LIGHT = fusionar(theme, themeInline, root);
const DARK = fusionar(theme, themeInline, root, darkClass);

const color = (token: string, scope: Map<string, string>) => resolver(`var(${token})`, scope);

const TEMAS: [string, Map<string, string>][] = [
  ["light", LIGHT],
  ["dark", DARK],
];

/**
 * Toda superficie sobre la que puede caer texto. `surface-hover` incluido: hay
 * cards con `hover:bg-surface-subtle` cuyo timestamp es `text-foreground-muted`,
 * o sea el fondo se mueve bajo el texto en cada hover.
 */
const SUPERFICIES = [
  "--color-canvas",
  "--color-surface",
  "--color-surface-subtle",
  "--color-surface-raised",
  "--color-surface-hover",
];

/** El assert de toda la casa: imprime el ratio medido y los dos hex. */
function esperaContraste(fg: string, bg: string, min: number, etiqueta: string): number {
  const ratio = wcagContrast(fg, bg);
  expect(
    ratio,
    `${etiqueta}\n  medido: ${fg} sobre ${bg} = ${ratio.toFixed(2)}:1 · mínimo ${min}:1`,
  ).toBeGreaterThanOrEqual(min);
  return ratio;
}

/* ═══════════════════ 1. tokens que no dependen del tenant ═══════════════════ */

describe.each(TEMAS)("globals.css — matriz de contraste, tema %s", (tema, scope) => {
  const c = (token: string) => color(token, scope);

  describe.each(SUPERFICIES)("texto sobre %s (1.4.3, ≥4.5)", (superficie) => {
    it.each([
      "--color-foreground",
      "--color-foreground-secondary",
      "--color-foreground-muted",
      "--color-placeholder",
    ])("%s", (token) => {
      esperaContraste(c(token), c(superficie), AA, `${token} sobre ${superficie} (${tema})`);
    });
  });

  /**
   * La familia `-ink`: el estado escrito como PALABRAS. El fill de §2.3 daba
   * 3.28:1 (warning), 4.43:1 (success) y 3.64:1 (gold) sobre fondo claro — por
   * eso `-ink` existe. Se valida contra su propio `-bg` Y contra las cinco
   * superficies: así el call site nunca tiene que averiguar cuál pasa y cuál no.
   */
  describe.each(["success", "warning", "danger", "info"])("%s-ink (1.4.3, ≥4.5)", (estado) => {
    it("sobre su propio -bg", () => {
      esperaContraste(
        c(`--color-${estado}-ink`),
        c(`--color-${estado}-bg`),
        AA,
        `${estado}-ink sobre ${estado}-bg (${tema})`,
      );
    });

    it.each(SUPERFICIES)("sobre %s", (superficie) => {
      esperaContraste(
        c(`--color-${estado}-ink`),
        c(superficie),
        AA,
        `${estado}-ink sobre ${superficie} (${tema})`,
      );
    });
  });

  // `gold` no tiene `-bg`: el dorado nunca es un fondo teñido (§3.3).
  it.each(SUPERFICIES)("gold-ink sobre %s (1.4.3, ≥4.5)", (superficie) => {
    esperaContraste(c("--color-gold-ink"), c(superficie), AA, `gold-ink sobre ${superficie} (${tema})`);
  });

  // Sin inline style del tenant: los escalones default (brand-700 / brand-300).
  // El barrido por tenant vive en la segunda mitad del archivo.
  it.each(SUPERFICIES)("brand-ink sobre %s (1.4.3, ≥4.5)", (superficie) => {
    esperaContraste(c("--color-brand-ink"), c(superficie), AA, `brand-ink sobre ${superficie} (${tema})`);
  });

  it("brand-ink sobre brand-tint (el chip de marca)", () => {
    esperaContraste(c("--color-brand-ink"), c("--color-brand-tint"), AA, `brand-ink sobre brand-tint (${tema})`);
  });

  // `on-x` = el label ADENTRO del fill sólido `bg-x`.
  it.each(["success", "warning", "danger", "info"])("on-%s sobre su relleno (≥4.5)", (estado) => {
    esperaContraste(
      c(`--color-on-${estado}`),
      c(`--color-${estado}`),
      AA,
      `on-${estado} sobre el relleno ${estado} (${tema})`,
    );
  });

  it("on-surface-inverse sobre surface-inverse (la barra offline)", () => {
    esperaContraste(
      c("--color-on-surface-inverse"),
      c("--color-surface-inverse"),
      AA,
      `on-surface-inverse sobre surface-inverse (${tema})`,
    );
  });

  /**
   * El borde que IDENTIFICA un estado. Único call site legítimo: la solicitud
   * pendiente recibida. `brand-subtle` (1.59/2.07) y `brand` (2.63/2.22 contra
   * bg-surface con un tenant de hue claro) no alcanzan; `brand-strong` sí.
   */
  it.each(SUPERFICIES)("border-brand-strong sobre %s (1.4.11, ≥3)", (superficie) => {
    esperaContraste(
      c("--color-brand-strong"),
      c(superficie),
      UI,
      `brand-strong sobre ${superficie} (${tema})`,
    );
  });

  it("el anillo de foco se ve contra canvas y surface (1.4.11, ≥3)", () => {
    for (const superficie of ["--color-canvas", "--color-surface"]) {
      esperaContraste(c("--color-focus-ring"), c(superficie), UI, `focus-ring sobre ${superficie} (${tema})`);
    }
  });

  /**
   * El complemento del comentario de arriba: `brand-subtle` tiene que quedar
   * POR DEBAJO de 3:1. Si alguien lo sube, este test explota y lo obliga a
   * decidir a conciencia — porque el día que parezca una señal de estado, se
   * va a usar como señal de estado.
   */
  it("brand-subtle NO llega a 3:1: es decoración, no señal", () => {
    const ratio = wcagContrast(c("--color-brand-subtle"), c("--color-surface"));
    expect(
      ratio,
      `brand-subtle sobre surface (${tema})\n  medido: ${ratio.toFixed(2)}:1 · tiene que ser < ${UI}:1.\n` +
        "  Si de verdad necesitás un borde de marca que señale un estado, usá `border-brand-strong`.",
    ).toBeLessThan(UI);
  });
});

/* ═══════════════════ 2. la marca del tenant (brand-pipeline) ═══════════════════ */

/**
 * Un tenant no elige su marca para que nos cierre la matriz: elige un amarillo
 * neón, o un navy que se funde con el canvas oscuro, o blanco puro. El pipeline
 * tiene que corregirlos a todos. Los hexes de abajo son los casos que rompen
 * cada lazo del pipeline por un lado distinto.
 *
 * Barrido completo (726 tenants: 36 hues × 5 lightness × 4 chromas + los 6 reales)
 * corrido a mano contra estas mismas aserciones: 0 fallos. Pisos medidos —
 * ink 5.48:1 · fill/canvas 3.00:1 · foreground/brand 4.52:1. El fill roza el 3:1
 * porque el pipeline lo empuja de a 0.01 de lightness hasta cruzarlo: ese es su
 * contrato, no una casualidad.
 */
const TENANTS_ADVERSARIOS: [string, string][] = [
  ["default del pipeline", "#1A5EDB"],
  ["terracota (tenant real)", "#C0492A"],
  ["neón verde", "#00FF00"],
  ["neón cian", "#00FFFF"],
  ["neón magenta", "#FF00FF"],
  ["amarillo puro", "#FFD400"],
  ["navy casi negro", "#0A1A3C"],
  ["blanco puro", "#FFFFFF"],
  ["negro puro", "#000000"],
  ["pastel rosa", "#FFD1DC"],
  ["pastel lavanda", "#C8B6FF"],
  ["gris medio (croma cero)", "#808080"],
];

/**
 * Las superficies reales, resueltas del CSS: si mañana `--cl-dark-surface-raised`
 * se aclara, este barrido lo siente. El pipeline ancla sus lazos en estos mismos
 * fondos (`LIGHT_SURFACE`, `DARK_SURFACE_RAISED`), así que no pueden divergir.
 */
const FONDOS = {
  light: {
    canvas: color("--color-canvas", LIGHT),
    surface: color("--color-surface", LIGHT),
    "surface-raised": color("--color-surface-raised", LIGHT),
  },
  dark: {
    canvas: color("--color-canvas", DARK),
    surface: color("--color-surface", DARK),
    "surface-raised": color("--color-surface-raised", DARK),
  },
} as const;

describe.each(TENANTS_ADVERSARIOS)("brand-pipeline — tenant %s (%s)", (_etiqueta, hex) => {
  const tema = buildBrandScale(hex);

  describe.each(["light", "dark"] as const)("en %s", (nombre) => {
    const tono = tema[nombre];
    const fondos = FONDOS[nombre];

    it("brand-foreground es AA sobre el relleno de marca (el label del CTA)", () => {
      esperaContraste(tono.foreground, tono.brand, AA, `${hex} → brand-foreground sobre brand (${nombre})`);
    });

    it("el relleno de marca se distingue del canvas (1.4.11, ≥3)", () => {
      // Un amarillo #FFD400 daba un botón de 1.39:1 sobre el canvas claro: un
      // rectángulo invisible con un label negro flotando.
      esperaContraste(tono.brand, fondos.canvas, UI, `${hex} → brand sobre canvas (${nombre})`);
    });

    it.each(Object.entries(fondos))("brand-ink es AA como texto sobre %s", (_donde, fondo) => {
      esperaContraste(tono.ink, fondo, AA, `${hex} → brand-ink sobre ${fondo} (${nombre})`);
    });

    it("brand-ink sobre su propio tint (chips, avatares)", () => {
      esperaContraste(tono.ink, tono.tint, AA, `${hex} → brand-ink sobre brand-tint (${nombre})`);
    });

    /**
     * `brand-strong` es un ALIAS de `brand-ink` (mismo tono, otro rol). Como
     * BORDE sólo necesita 3:1, así que el 4.5:1 de arriba ya le sobra — pero se
     * afirma aparte porque el día que `brand-strong` tenga tono propio, este es
     * el test que tiene que seguir pasando.
     */
    it.each(Object.entries(fondos))("border-brand-strong identifica el estado sobre %s (≥3)", (_donde, fondo) => {
      esperaContraste(tono.ink, fondo, UI, `${hex} → brand-strong sobre ${fondo} (${nombre})`);
    });
  });
});

describe("brand-pipeline — las anclas del pipeline son las superficies del CSS", () => {
  it("no pueden divergir en silencio", () => {
    // brand-pipeline.ts hardcodea LIGHT_SURFACE/#FFFFFF y DARK_SURFACE_RAISED/#2B2820
    // como los fondos MÁS CLAROS de cada tema. Si acá se mueven, el pipeline valida
    // contra un fondo que ya no existe y `brand-ink` deja de ser AA sin avisar.
    expect(FONDOS.light.surface.toLowerCase()).toBe("#ffffff");
    expect(FONDOS.dark["surface-raised"].toLowerCase()).toBe("#2b2820");
    expect(FONDOS.light.canvas.toLowerCase()).toBe("#fcfcfb");
    expect(FONDOS.dark.canvas.toLowerCase()).toBe("#17150f");
  });
});
