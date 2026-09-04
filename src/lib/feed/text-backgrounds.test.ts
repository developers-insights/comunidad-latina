import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { converter, formatHex, interpolate, parse, wcagContrast } from "culori";
import { describe, expect, it } from "vitest";
import {
  AUTO_TEXT_BACKGROUNDS,
  TEXT_BACKGROUNDS,
  TEXT_BACKGROUND_IDS,
  autoTextBackgroundOf,
  isTextBackgroundId,
  textBackgroundOf,
} from "./text-backgrounds";

/**
 * EL CONTRASTE DE LOS FONDOS DE TEXTO SE MIDE, NO SE ESTIMA.
 *
 * Un fondo de este catálogo es lo único que hay detrás del cuerpo de la
 * publicación —el texto ES la pieza gráfica—, así que si un tramo del degradado
 * se aclara de más, la publicación deja de leerse. «Se ve bien en mi monitor» no
 * es una verificación: acá se resuelven los acentos desde `globals.css`, se
 * rehacen las mezclas en oklab (el MISMO espacio que usa `color-mix` en el
 * navegador) y se mide con culori.
 *
 * El modelo es a propósito MÁS SEVERO que la realidad: el brillo radial se suma
 * como un overlay PLANO al 100% de su opacidad sobre cada tramo, cuando en la
 * pieza real sólo pega así de fuerte en el centro del radial. Si pasa acá, pasa
 * en pantalla. Es el mismo criterio con el que se habían verificado las tres
 * variantes originales de `text-banner.tsx`.
 *
 * Y ancla lo otro que no se puede romper sin que nadie se entere: que el pozo
 * del modo Automático siga siendo los tres fondos de siempre, en el mismo orden.
 * Correrlo repinta de golpe TODA publicación de texto ya publicada.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GLOBALS = readFileSync(resolve(HERE, "../../app/globals.css"), "utf8");
/** Sin comentarios: adentro hay hexadecimales de ejemplo que no son tokens. */
const CSS = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, "");

const AA = 4.5;
const rgb = converter("rgb");

/**
 * El valor de un token, exigiendo que esté declarado UNA sola vez con un
 * hexadecimal literal. Si mañana alguno pasa a depender del tema (dos
 * declaraciones) o a resolverse por `var()`, este test falla en vez de medir el
 * color equivocado en silencio.
 */
function token(nombre: string): string {
  const matches = [...CSS.matchAll(new RegExp(`${nombre}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, "g"))];
  expect(matches.length, `${nombre} tendría que estar declarado una sola vez con un hex`).toBe(1);
  return matches[0][1];
}

const SHADE = token("--color-media-shade");
const INK = token("--color-on-media");

/** `color-mix(in oklab, acento pct%, sombra)`, con el mismo espacio que el navegador. */
function mezcla(acentoHex: string, pct: number): string {
  return formatHex(interpolate([SHADE, acentoHex], "oklab")(pct / 100));
}

/** El brillo, como overlay PLANO al 100% de su opacidad (peor caso). */
function conBrillo(baseHex: string, pct: number): string {
  const base = rgb(parse(baseHex));
  const tinta = rgb(parse(INK));
  const a = pct / 100;
  const m = (x: number, y: number) => x * (1 - a) + y * a;
  return formatHex({
    mode: "rgb",
    r: m(base!.r, tinta!.r),
    g: m(base!.g, tinta!.g),
    b: m(base!.b, tinta!.b),
  });
}

/** `var(--x)` → el hex declarado en globals.css. */
function acentoHex(acento: string): string {
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(acento);
  expect(m, `el acento tiene que ser una variable de globals.css, no "${acento}"`).not.toBeNull();
  return token(m![1]);
}

describe("Fondos de texto: cada tramo pasa AA contra la tinta clara", () => {
  for (const fondo of TEXT_BACKGROUNDS) {
    it(`${fondo.label} (${fondo.id}) — los tres tramos, con el brillo encima`, () => {
      for (const stop of fondo.recorrido) {
        const base = mezcla(acentoHex(stop.acento), stop.tinta);
        const ratio = wcagContrast(conBrillo(base, fondo.brillo.pct), INK);
        expect(
          ratio,
          `${fondo.id}: el tramo ${stop.acento} al ${stop.tinta}% queda en ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA);
      }
    });
  }

  it("ningún fondo se apoya en un color literal: todos salen de la paleta de la app", () => {
    for (const fondo of TEXT_BACKGROUNDS) {
      for (const stop of fondo.recorrido) {
        expect(stop.acento).toMatch(/^var\(--(brand|accent)-[a-z-]+\)$/);
      }
    }
  });
});

describe("Fondos de texto: el catálogo es cerrado y sin sorpresas", () => {
  it("son entre 6 y 8, con ids y etiquetas únicos", () => {
    expect(TEXT_BACKGROUNDS.length).toBeGreaterThanOrEqual(6);
    expect(TEXT_BACKGROUNDS.length).toBeLessThanOrEqual(8);
    expect(new Set(TEXT_BACKGROUND_IDS).size).toBe(TEXT_BACKGROUNDS.length);
    expect(new Set(TEXT_BACKGROUNDS.map((f) => f.label)).size).toBe(TEXT_BACKGROUNDS.length);
  });

  it("la tupla de ids y el catálogo no se separaron (mismo orden, mismos ids)", () => {
    // La tupla es la que tipa el borde del servidor (`z.enum`) y la que repite
    // el CHECK de la 0128; el catálogo es el que pinta. Si divergen, un fondo
    // pasa la validación y no lo dibuja nadie, o al revés.
    expect(TEXT_BACKGROUNDS.map((f) => f.id)).toEqual([...TEXT_BACKGROUND_IDS]);
  });

  it("cada fondo trae su degradado y su brillo ya armados", () => {
    for (const fondo of TEXT_BACKGROUNDS) {
      expect(fondo.field).toMatch(/^linear-gradient\(/);
      expect(fondo.field).toContain("color-mix(in oklab");
      expect(fondo.glow).toMatch(/^radial-gradient\(/);
    }
  });

  it("`isTextBackgroundId` acepta el catálogo y rechaza cualquier otra cosa", () => {
    for (const id of TEXT_BACKGROUND_IDS) expect(isTextBackgroundId(id)).toBe(true);
    for (const basura of ["", "violeta", "AMANECER", null, undefined, 3, {}]) {
      expect(isTextBackgroundId(basura)).toBe(false);
    }
  });
});

describe("Fondos de texto: el modo Automático no puede correrse", () => {
  it("el pozo del sorteo son los tres de siempre, en el mismo orden", () => {
    // Cambiar esto repinta TODA publicación de texto ya publicada: si algún día
    // se decide de verdad, se cambia acá a mano y con esa decisión escrita.
    expect(AUTO_TEXT_BACKGROUNDS).toEqual(["amanecer", "noche", "plaza"]);
  });

  it("el pozo es un subconjunto del catálogo (si no, `textBackgroundOf` explota)", () => {
    for (const id of AUTO_TEXT_BACKGROUNDS) {
      expect(TEXT_BACKGROUND_IDS).toContain(id);
    }
  });

  it("el mismo id sortea SIEMPRE el mismo fondo", () => {
    const id = "5a2d8e1f-1c55-4b88-ae32-88d3b2c51f21";
    expect(autoTextBackgroundOf(id)).toBe(autoTextBackgroundOf(id));
  });

  it("ids distintos no caen todos en el mismo fondo", () => {
    const ids = ["0e2b", "9ffa", "c001", "d5e6", "77aa", "1234", "abcd", "ff00"];
    expect(new Set(ids.map(autoTextBackgroundOf)).size).toBeGreaterThan(1);
  });
});

describe("Fondos de texto: cómo se resuelve el fondo de una publicación", () => {
  const POST = "5a2d8e1f-1c55-4b88-ae32-88d3b2c51f21";

  it("con un fondo elegido, manda el elegido", () => {
    expect(textBackgroundOf(POST, "fiesta").id).toBe("fiesta");
    expect(textBackgroundOf(POST, "cafe").id).toBe("cafe");
  });

  it("sin elegir (publicación vieja o modo Automático), sortea por id", () => {
    const sorteado = autoTextBackgroundOf(POST);
    expect(textBackgroundOf(POST, null).id).toBe(sorteado);
    expect(textBackgroundOf(POST, undefined).id).toBe(sorteado);
  });

  it("con un valor que el catálogo no conoce, cae al sorteo y NO devuelve nada roto", () => {
    const fondo = textBackgroundOf(POST, "un-fondo-que-no-existe");
    expect(fondo.id).toBe(autoTextBackgroundOf(POST));
    expect(fondo.field).toContain("linear-gradient");
  });
});
