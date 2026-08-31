import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wcagContrast } from "culori";
import { describe, expect, it } from "vitest";

/**
 * =============================================================================
 * LAS CUATRO TINTAS DE LA BARRA TIENEN QUE SEGUIR SIENDO LEGIBLES
 * =============================================================================
 *
 * Feedback cliente 2026-08-31: «agregar un poco más de color a los post». La
 * barra dejó de ser gris y ahora cada acción nace con su tinta.
 *
 * El riesgo que esto abre es concreto y tiene nombre. `globals.css` tiene DOS
 * familias de color y se parecen mucho por fuera:
 *
 *   · `--accent-*`  → DECORATIVOS. Cápsulas, anillos, gradientes. Su propio
 *     comentario avisa: «el texto encima usa siempre tokens -ink». Ahí adentro
 *     vive `--accent-negocios`, que es el amarillo de la marca: 1.7:1 como
 *     texto sobre la tarjeta blanca.
 *   · `--*-ink`     → TEXTO. Medidos a ≥4.5:1 contra las cinco superficies.
 *
 * La barra ya usa acentos en la MISMA tarjeta (el chip de vertical, el CTA), o
 * sea que "usá el acento del módulo" es un cambio de una línea que alguien va a
 * proponer de buena fe, va a compilar, se va a ver bien en la captura de
 * escritorio y va a dejar el número de me gusta ilegible.
 *
 * Este archivo es el gate: mide los cuatro tokens contra las cinco superficies
 * en los dos temas, resolviendo la cadena de `var()` desde el CSS REAL. Un
 * comentario no falla un build; esto sí.
 *
 * Vive acá y no en `src/test/theme-contrast.test.ts` a propósito: estos cuatro
 * tokens son de ESTE componente, y quien los mueva va a estar mirando esta
 * carpeta. (El de `src/test` cubre la familia `-ink` de la que salen; los dos
 * miden por su cuenta, sin compartir helper, para que un bug en el helper no
 * haga pasar a los dos.)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, "../../app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

const AA = 4.5; // WCAG 1.4.3 — el ícono va con su número al lado: es texto.

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

const TEMAS: [string, Map<string, string>][] = [
  ["light", LIGHT],
  ["dark", DARK],
];

/** Toda superficie sobre la que puede caer la barra (la tarjeta y sus hovers). */
const SUPERFICIES = [
  "--color-canvas",
  "--color-surface",
  "--color-surface-subtle",
  "--color-surface-raised",
  "--color-surface-hover",
];

/** Las cuatro acciones, en el orden en que se ven. */
const ACCIONES = [
  "--color-action-like",
  "--color-action-comment",
  "--color-action-share",
  "--color-action-save",
];

describe.each(TEMAS)("las tintas de la barra de acciones — tema %s", (tema, scope) => {
  const c = (token: string) => resolver(`var(${token})`, scope);

  describe.each(ACCIONES)("%s (1.4.3, ≥4.5)", (token) => {
    it.each(SUPERFICIES)("sobre %s", (superficie) => {
      const fg = c(token);
      const bg = c(superficie);
      const ratio = wcagContrast(fg, bg);
      expect(
        ratio,
        `${token} sobre ${superficie} (${tema})\n  medido: ${fg} sobre ${bg} = ${ratio.toFixed(2)}:1 · mínimo ${AA}:1`,
      ).toBeGreaterThanOrEqual(AA);
    });
  });

  /**
   * Cuatro tintas que se parecen no son cuatro tintas: si dos acciones salen
   * del mismo hex, la barra volvió a ser monocroma sin que nadie lo note.
   *
   * Con `--color-brand` esto NO era teórico: la marca la elige el tenant, y un
   * tenant de marca roja habría dejado "guardar" del mismo color que "me
   * gusta". Por eso ninguna de las cuatro sale de la marca.
   */
  it("las cuatro son colores DISTINTOS", () => {
    const valores = ACCIONES.map((token) => [token, c(token).toLowerCase()] as const);
    const unicos = new Set(valores.map(([, hex]) => hex));
    expect(
      unicos.size,
      `dos acciones comparten tinta en ${tema}: ${valores.map(([t, h]) => `${t}=${h}`).join(" · ")}`,
    ).toBe(ACCIONES.length);
  });
});

/**
 * El gate de verdad. Los `--accent-*` son la tentación —ya se usan en ESTA
 * tarjeta, en el chip de vertical y en el CTA— y son decorativos por contrato.
 * Apuntar una acción ahí es el error que este archivo existe para atajar; el
 * test de arriba lo caza por contraste, y éste lo dice con todas las letras
 * para que el mensaje de la falla explique QUÉ hacer.
 */
it("ninguna tinta sale de la paleta decorativa de acentos", () => {
  for (const token of ACCIONES) {
    const declarado = themeInline.get(token);
    expect(declarado, `${token} no está declarado en @theme inline`).toBeDefined();
    expect(
      declarado,
      `${token} apunta a un --accent-*, que es DECORATIVO (ver globals.css). ` +
        `La barra escribe texto: tiene que salir de la familia -ink.`,
    ).not.toMatch(/--accent-/);
  }
});
