import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * LA RED CONTRA LA REGRESIÓN (defecto [11]).
 *
 * La migración de theming dejó `src/` con CERO utilities `dark:` y CERO
 * primitivos de color crudos. Eso es cierto HOY y se pudre en el primer PR que
 * escriba `bg-white` sin pensarlo. `theme-tokens.test.ts` sólo hace grep sobre
 * `globals.css`; `eslint.config.mjs` no restringe clases. Nadie mira el JSX.
 * Este archivo mira el JSX.
 *
 * Tres invariantes, sobre todo `src/` menos los tests:
 *   1. Ninguna utility `dark:`  — el theming voltea solo, vía tokens semánticos.
 *   2. Ningún primitivo de color — `bg-white`, `text-neutral-500`, `border-black`…
 *      se ven idénticos en light y en dark.
 *   3. Ningún hex literal en JSX — un `#1a5edb` hardcodeado ignora al tenant.
 *
 * ═══ POR QUÉ HAY UN TOKENIZER Y NO UN GREP ═══
 * Un grep pelado se rompe por los dos lados:
 *  · FALSO POSITIVO: varios comentarios traen ejemplos como
 *    `dark:hover:bg-neutral-800`, y `brand-pipeline.ts` declara `dark: BrandTone`.
 *    Nada de eso es una utility.
 *  · FALSO NEGATIVO: si "arreglás" lo anterior tirando la línea entera cuando
 *    tiene un `//`, entonces `<div className="dark:bg-x" /> // nota` deja de
 *    verse. Y si tirás los template literals enteros, se te escapa
 *    `` cn(`${activo ? "dark:bg-x" : ""}`) ``.
 * Por eso `soloCodigo()` borra comentarios de verdad —respetando strings,
 * template literals, sus interpolaciones `${…}` y los regex literales— y deja
 * TODO lo demás intacto, con los offsets y los saltos de línea en su lugar: así
 * los números de línea del reporte son los del archivo real.
 *
 * Los `*.test.ts(x)` quedan fuera del barrido: no se envían al navegador, y un
 * escáner que se escanea a sí mismo siempre encuentra sus propios patrones (este
 * archivo está lleno de `dark:` y de hexes, a propósito, en los casos de abajo).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const ROOT = resolve(SRC, "..");

/** Ruta relativa a la raíz del repo, siempre con `/`: el reporte se lee igual en Windows. */
const rutaRel = (archivo: string) => relative(ROOT, archivo).split(sep).join("/");

const ES_TEST = /\.test\.tsx?$/;

function archivosFuente(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const full = join(dir, nombre);
    if (statSync(full).isDirectory()) archivosFuente(full, acc);
    else if (/\.tsx?$/.test(nombre) && !ES_TEST.test(nombre)) acc.push(full);
  }
  return acc;
}

/**
 * Caracteres tras los cuales una `/` abre un REGEX y no una división.
 *
 * La lista es corta a propósito. `{`, `}`, `<` y `>` NO están, y no es un olvido:
 * en TSX, `{texto}</div>` pone un `}` justo antes de la barra de `</div>`. Con
 * `}` en esta lista, el parser entraba en "modo regex", se comía el resto de la
 * línea buscando la barra de cierre y se saltaba un `// comentario` posterior —
 * que entonces sí matcheaba `dark:`. Un falso positivo nacido de la cura.
 */
const ANTES_DE_REGEX = /[=(,:!&|?;+]/;

/**
 * Devuelve el código con los comentarios reemplazados por espacios (mismos
 * offsets, mismos saltos de línea). El contenido de strings y templates se
 * CONSERVA: ahí es justo donde viven las clases de Tailwind.
 */
function soloCodigo(src: string): string {
  const out = src.split("");
  const borrar = (i: number) => {
    if (src[i] !== "\n") out[i] = " ";
  };

  /** Pila de contextos. `code` cuenta llaves para saber dónde cierra un `${…}`. */
  const pila: { tipo: "code" | "template"; llaves: number }[] = [{ tipo: "code", llaves: 0 }];
  let i = 0;
  let previo = "";
  const n = src.length;

  while (i < n) {
    const tope = pila[pila.length - 1];
    const c = src[i];
    const d = src[i + 1];

    if (tope.tipo === "template") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        pila.pop();
        previo = "`";
        i++;
        continue;
      }
      // Interpolación: adentro vuelve a haber código (y comentarios que borrar).
      if (c === "$" && d === "{") {
        pila.push({ tipo: "code", llaves: 0 });
        previo = "{";
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // ── contexto de código ──
    // Los comentarios se chequean ANTES que el regex: `{/* … */}` es un comentario.
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") {
        borrar(i);
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      borrar(i);
      borrar(i + 1);
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        borrar(i);
        i++;
      }
      if (i < n) {
        borrar(i);
        borrar(i + 1);
        i += 2;
      }
      continue;
    }
    // Una comilla abre un string sólo si NO viene pegada a un identificador. En
    // el texto JSX `<p>Don't</p> {/* … */}` el apóstrofo abriría un string falso
    // que se comería el comentario de al lado — y ese comentario volvería a
    // matchear `dark:`. Los strings de verdad siempre llegan detrás de `=`, `(`,
    // `,`, `:`, `[`, `{` o un operador.
    if ((c === '"' || c === "'") && !/[\w)\]]/.test(previo)) {
      const comilla = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === comilla) {
          i++;
          break;
        }
        if (src[i] === "\n") break; // string sin cerrar: no colgarse
        i++;
      }
      previo = comilla;
      continue;
    }
    if (c === "`") {
      pila.push({ tipo: "template", llaves: 0 });
      previo = "`";
      i++;
      continue;
    }
    if (c === "/" && ANTES_DE_REGEX.test(previo)) {
      i++;
      let enClase = false;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "[") enClase = true;
        else if (src[i] === "]") enClase = false;
        else if (src[i] === "/" && !enClase) {
          i++;
          break;
        } else if (src[i] === "\n") break; // regex sin cerrar: cortar en la línea
        i++;
      }
      previo = "/";
      continue;
    }
    if (c === "{") {
      tope.llaves++;
      previo = "{";
      i++;
      continue;
    }
    if (c === "}") {
      if (tope.llaves === 0 && pila.length > 1) {
        pila.pop(); // cierra un `${…}`: volvemos al template
      } else {
        tope.llaves--;
      }
      previo = "}";
      i++;
      continue;
    }
    if (!/\s/.test(c)) previo = c;
    i++;
  }
  return out.join("");
}

/* ────────────────────────── los tres detectores ────────────────────────── */

/**
 * `dark:` seguido de algo que sólo puede ser una utility (letra, `[` de valor
 * arbitrario, `(` de `duration-(--x)`). Deja pasar `dark: BrandTone` (clave de
 * objeto TS: lleva espacio) y `d ? "dark" : "light"` (la comilla corta).
 *
 * La cola `[^\s"'`]*` no cambia QUÉ matchea —el ancla ya decidió— sino qué se
 * REPORTA: `dark:bg-surface` en vez de `dark:b`. A las 2am eso es la diferencia
 * entre saber qué borrar y tener que ir a buscarlo.
 */
const RE_DARK = /\bdark:[a-z[(][^\s"'`]*/g;

/** Los primitivos que NO voltean con el tema. `\b` evita comerse `auto-black`. */
const RE_PRIMITIVO =
  /\b(bg|text|border|from|to|via|ring|divide|placeholder|fill|stroke|decoration|caret|accent|outline|shadow)-(white|black|neutral-\d+)\b/g;

/** Hex CSS válido: 3, 4, 6 u 8 dígitos. `href="#faq"` no matchea; `#fff` sí. */
const RE_HEX =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;

interface Hallazgo {
  archivo: string;
  linea: number;
  texto: string;
}

function escanear(archivo: string, codigo: string, re: RegExp): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  for (const m of codigo.matchAll(re)) {
    const idx = m.index ?? 0;
    hallazgos.push({
      archivo: rutaRel(archivo),
      linea: codigo.slice(0, idx).split("\n").length,
      texto: m[0],
    });
  }
  return hallazgos;
}

/* ─────────── qué token usar en vez del primitivo (§ Vocabulario de globals.css) ─────────── */

const REEMPLAZO: Record<string, string> = {
  white: "bg-surface · text-brand-foreground (sobre bg-brand) · text-on-media (sobre foto)",
  black: "bg-media-shade (tinta sobre foto) · bg-scrim (backdrop de diálogo)",
  "neutral-0": "bg-surface / bg-surface-raised",
  "neutral-25": "bg-canvas",
  "neutral-50": "bg-surface-subtle · text-on-surface-inverse · text-foreground (dark)",
  "neutral-100": "bg-surface-hover · border-border-subtle · bg-surface-inverse (dark)",
  "neutral-200": "border-border",
  "neutral-300": "border-border-strong · text-foreground-secondary (dark)",
  "neutral-400": "text-placeholder · text-foreground-muted (dark)",
  "neutral-500": "text-foreground-muted",
  "neutral-600": "text-foreground-secondary",
  "neutral-700": "border-border-strong",
  "neutral-800": "bg-surface-inverse · bg-surface (dark)",
  "neutral-900": "text-foreground · bg-canvas (dark)",
  "neutral-950": "text-on-warning / text-on-success / text-on-danger · bg-media-shade",
};

function sugerencia(match: string): string {
  const primitivo = match.slice(match.indexOf("-") + 1);
  return REEMPLAZO[primitivo] ?? "un token semántico de globals.css (ver «Vocabulario»)";
}

const AYUDA_DARK = [
  "Cero utilities `dark:` en src/. El theming pasa por tokens semánticos que",
  "voltean solos (bg-surface, text-foreground, border-border…).",
  "Si necesitás una `dark:`, FALTA UN TOKEN: pedilo, no lo parchees.",
  "Contrato completo: src/app/globals.css, cabecera del archivo.",
].join("\n");

const AYUDA_PRIMITIVO = [
  "Los primitivos de color NO voltean: se ven idénticos en light y en dark.",
  "Cada uno tiene su token semántico — la flecha `→` dice cuál.",
  "Vocabulario completo: src/app/globals.css, cabecera del archivo.",
].join("\n");

const AYUDA_HEX = [
  "Un hex literal en JSX ignora al tenant (la marca la inyecta brand-pipeline)",
  "y no voltea con el tema. Usá un token: bg-brand, text-brand-ink, bg-surface…",
  "Si de verdad es un DATO y no cromo de la app, agregá el archivo a",
  "HEX_PERMITIDO con su razón — y que sea una razón, no una excusa.",
].join("\n");

/** Un renglón por hallazgo, con la sugerencia pegada al lado. */
function reporte(hallazgos: Hallazgo[], conSugerencia = false): string[] {
  return hallazgos.map(
    (h) =>
      `${h.archivo}:${h.linea}  ✗ ${h.texto}` +
      (conSugerencia ? `  →  ${sugerencia(h.texto)}` : ""),
  );
}

/* ───────────────────────────── allowlist ─────────────────────────────
 *
 * Cada excepción se verificó ABRIENDO el archivo. Sólo hexes, y sólo en `.tsx`:
 * no hay una sola `dark:` ni un solo primitivo crudo en todo `src/`, así que
 * esas dos reglas no tienen —ni deben tener— excepciones.
 *
 * NO figura `src/components/marketing/hero-backdrop.tsx`, que el brief listaba
 * como excepción esperada: se abrió y NO tiene hexes ni primitivos. Tiñe con
 * `from-media-shade/92` y arma su scrim con `rgba(${INK},…)` desde una constante.
 * No hay nada que perdonarle. (Ver el test «la allowlist no tiene entradas
 * muertas»: una excepción de más es una puerta abierta sin razón.)
 *
 * El hex sólo se persigue en `.tsx` porque la regla es "hex en JSX". En `.ts`
 * un hex suele ser un DATO legítimo: `FALLBACK_HEX` del brand pipeline,
 * `DARK_THEME_COLOR` del <meta theme-color>, los anclas de contraste.
 */
const HEX_PERMITIDO = new Map<string, string>([
  [
    "src/app/global-error.tsx",
    "Reemplaza el <html> entero cuando el root layout ya explotó: no hay Tailwind " +
      "ni globals.css que valgan. Declara su propia paleta light/dark en un <style> " +
      "inline, con los mismos valores que los --cl-*.",
  ],
  [
    "src/components/experience/brand-mark.tsx",
    "Stops de gradiente de un SVG. Los blancos (#FFFFFF del gloss/shine, #FCFCFB del " +
      "monograma) son LUZ sobre el emblema, no cromo de UI: constantes en los dos temas " +
      "a propósito, porque un logo no se invierte (§2.8). Los hexes de marca son sólo " +
      "el fallback de var(--color-brand-N) por si el pipeline no resolviera.",
  ],
  [
    "src/components/admin/create-tenant-form.tsx",
    "#1A5EDB es el valor inicial de un <input type=color>: un DATO (la marca que el " +
      "admin va a elegir), no un color de UI. Nunca pinta cromo de la app.",
  ],
]);

/* ─────────────────────────────── el barrido ─────────────────────────────── */

const FUENTES = archivosFuente(SRC);
const CODIGO = new Map(FUENTES.map((f) => [f, soloCodigo(readFileSync(f, "utf8"))]));

describe("invariantes de theming sobre src/ (defecto [11])", () => {
  it("el barrido encuentra los archivos: si esto falla, todo lo demás es vacuo", () => {
    // Un walker roto devuelve [] y los tres tests de abajo pasan sin mirar nada.
    expect(FUENTES.length).toBeGreaterThan(200);
    expect(FUENTES.some((f) => f.endsWith(".tsx"))).toBe(true);
  });

  it("ningún archivo usa una utility `dark:`", () => {
    const hallazgos = FUENTES.flatMap((f) => escanear(f, CODIGO.get(f)!, RE_DARK));
    expect(reporte(hallazgos), AYUDA_DARK).toEqual([]);
  });

  it("ningún archivo usa un primitivo de color crudo", () => {
    const hallazgos = FUENTES.flatMap((f) => escanear(f, CODIGO.get(f)!, RE_PRIMITIVO));
    expect(reporte(hallazgos, true), AYUDA_PRIMITIVO).toEqual([]);
  });

  it("ningún .tsx fuera de la allowlist tiene un hex literal", () => {
    const hallazgos = FUENTES.filter((f) => f.endsWith(".tsx"))
      .flatMap((f) => escanear(f, CODIGO.get(f)!, RE_HEX))
      .filter((h) => !HEX_PERMITIDO.has(h.archivo));
    expect(reporte(hallazgos), AYUDA_HEX).toEqual([]);
  });

  it("la allowlist no tiene entradas muertas", () => {
    const conHex = new Set(
      FUENTES.filter((f) => f.endsWith(".tsx"))
        .filter((f) => escanear(f, CODIGO.get(f)!, RE_HEX).length > 0)
        .map(rutaRel),
    );
    const muertas = [...HEX_PERMITIDO.keys()].filter((a) => !conHex.has(a));
    expect(
      muertas,
      "Estos archivos están perdonados pero ya no tienen hexes: sacalos de HEX_PERMITIDO.",
    ).toEqual([]);
  });
});

/**
 * ═══ EL TEST DEL TEST ═══
 * Un guard que no se prueba a sí mismo es una fachada: un regex roto lo deja
 * pasar todo y el suite sigue verde. Los tres detectores se verificaron metiendo
 * el bug de verdad en un componente real (un `.tsx` con `dark:bg-surface` en un
 * template, `bg-white`, `text-neutral-500` y `#ff0000`): los tres fallaron, con
 * archivo, línea y token sugerido. Este bloque lo deja anclado para siempre.
 *
 * Los casos `false` no son adorno. Unos son los falsos positivos que HOY existen
 * en el repo (`dark: BrandTone` en brand-pipeline.ts, `d?"dark":"light"` en
 * theme-script-source.ts, los ejemplos `dark:hover:bg-…` de varios comentarios);
 * los otros son las trampas de parsear TSX con un tokenizer: el `}` de
 * `{texto}</div>` y el apóstrofo de `Don't`. Cada uno de esos dos rompió una
 * versión anterior de `soloCodigo()`.
 */
describe("los detectores detectan (y no se rompen con los falsos positivos reales)", () => {
  /** Copia sin `g`: `test()` sobre un regex global avanza `lastIndex` entre llamadas. */
  const sinGlobal = (re: RegExp) => new RegExp(re.source, re.flags.replace("g", ""));
  const detecta = (re: RegExp, fuente: string) => sinGlobal(re).test(soloCodigo(fuente));

  const CASOS_DARK: [string, boolean][] = [
    ['<div className="dark:bg-surface" />', true],
    ['cn("flex", activo && "dark:text-foreground")', true],
    ['cn(`flex ${activo ? "dark:bg-brand" : ""}`)', true], // escondida en un template
    ['<div className="dark:bg-x" /> // con un comentario al lado', true], // no se traga la línea
    ['cva({ variants: { t: { on: "dark:ring-focus-ring" } } })', true],
    ['<span>{texto}</span> // ejemplo viejo: dark:bg-x', false], // el `}` no abre un regex
    ["<p>Don't</p> {/* dark:bg-x */}", false], // el apóstrofo no abre un string
    ['const t = "Don\'t"; // dark:bg-x', false], // …y adentro de un string sí es texto
    ["// ejemplo viejo: dark:hover:bg-neutral-800", false],
    ["/* reemplaza `dark:hover:bg-neutral-700/60` */", false],
    ["export interface BrandTheme { light: BrandTone; dark: BrandTone; }", false],
    ["const dark: BrandTone = { brand: x };", false], // anotación TS, lleva espacio
    ['const modo = esOscuro ? "dark" : "light";', false],
    ['const s = d?"dark":"light";', false], // theme-script-source
  ];

  it.each(CASOS_DARK)("`dark:` en %s → %s", (fuente, esperado) => {
    expect(detecta(RE_DARK, fuente)).toBe(esperado);
  });

  const CASOS_PRIMITIVO: [string, boolean][] = [
    ['<p className="bg-white" />', true],
    ['cn("text-neutral-500", "p-2")', true],
    ['<p className="hover:bg-neutral-100/60" />', true],
    ['<p className="border-black" />', true],
    ['<p className="from-black via-white to-neutral-900" />', true],
    ["// antes decía bg-neutral-800", false],
    ['<p className="bg-surface text-foreground-muted border-border" />', false],
    ['<p className="bg-media-shade/92 text-on-media" />', false],
    ['style={{ color: "var(--color-neutral-500)" }}', false], // `color-` no está en la lista
    ['const clase = "auto-black";', false], // sin `\b`, `to-black` matcheaba acá adentro
  ];

  it.each(CASOS_PRIMITIVO)("primitivo en %s → %s", (fuente, esperado) => {
    expect(detecta(RE_PRIMITIVO, fuente)).toBe(esperado);
  });

  const CASOS_HEX: [string, boolean][] = [
    ['<div style={{ color: "#1a5edb" }} />', true],
    ['<stop stopColor="#FFF" />', true],
    ['<stop stopColor="#2C6CE0" />', true],
    ['className="[color:var(--color-brand,#1a5edb)]"', true],
    ['<a href="#faq">…</a>', false], // ancla, no color
    ['<a href="#top">…</a>', false],
    ["// el default del pipeline es #1A5EDB", false],
    ['<div className="bg-brand" />', false],
  ];

  it.each(CASOS_HEX)("hex en %s → %s", (fuente, esperado) => {
    expect(detecta(RE_HEX, fuente)).toBe(esperado);
  });

  it("soloCodigo() conserva offsets: el número de línea es el del archivo", () => {
    const fuente = 'const a = 1;\n/* comentario\n   largo */\n<div className="bg-white" />';
    const codigo = soloCodigo(fuente);
    expect(codigo).toHaveLength(fuente.length);
    expect(escanear("x.tsx", codigo, RE_PRIMITIVO)[0].linea).toBe(4);
  });

  it("el reporte dice QUÉ token usar, no sólo que está prohibido", () => {
    const [linea] = reporte([{ archivo: "a.tsx", linea: 7, texto: "text-neutral-500" }], true);
    expect(linea).toBe("a.tsx:7  ✗ text-neutral-500  →  text-foreground-muted");
  });
});
