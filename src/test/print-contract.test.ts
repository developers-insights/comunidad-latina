import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { wcagContrast } from "culori";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * EL CONTRATO DE LA HOJA IMPRESA (defecto [12]).
 *
 * La página que la gente imprime es /guias/[slug]: trámites, ITIN, papeles que se
 * llevan a una oficina. El navegador NO imprime `background-color`, pero SÍ
 * imprime `color`. De ahí salen los dos modos de falla que este archivo ancla:
 *
 *  1. TINTA CLARA SOBRE PAPEL BLANCO. Todo el tema se fuerza a light dentro de
 *     `@media print` (eso ya estaba y funciona). Lo que faltaba es la familia
 *     `on-*`: `text-brand-foreground`, `text-on-success`, `text-on-danger`,
 *     `text-on-info`, `text-on-surface-inverse` y `text-on-media` son claras POR
 *     DEFINICIÓN — existen para leerse encima de un relleno saturado. Sin ese
 *     relleno quedan en 1.00:1. El tema no las arregla porque no dependen del tema.
 *
 *  2. CHROME ESCONDIDO CON UN ROL DE ARIA. El bloque print tenía
 *     `[role="status"], [aria-live] { display: none }` con un comentario que decía
 *     "cubre el banner offline y el de tenant mismatch". No: matchea 33 nodos de
 *     `src/`, y varios son el CONTENIDO — la burbuja de respuesta del asistente, el
 *     veredicto del verificador de estafas, el comprobante de "impulsado hasta". Un
 *     `aria-live` no dice "decoración": dice "esto apareció recién". Como
 *     `@media print` no depende del tema, eso rompía también al usuario en light.
 *
 * Los dos hooks explícitos, en globals.css, sin capa (le ganan a `@layer utilities`
 * sin `!important`):
 *   · `.cl-print-hide` → display: none. Chrome que en papel no significa nada.
 *   · `.cl-print-fill` → print-color-adjust: exact. Fuerza el relleno a imprimirse
 *     donde la tinta `on-*` lo necesita para existir.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const ROOT = resolve(SRC, "..");
const GLOBALS = readFileSync(resolve(SRC, "app/globals.css"), "utf8");
const CSS = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, "");

const PAPEL = "#ffffff";
/** AA de texto. Un `on-*` que caiga acá abajo contra el papel NO puede quedar suelto. */
const AA = 4.5;

/* ══════════════════════════════════════════════════════════════════════════
 * Resolución de tokens desde el CSS real (mismo algoritmo que theme-tokens.test)
 * ═════════════════════════════════════════════════════════════════════════ */

function declarations(bloque: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const chunk of bloque.split(";")) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+)$/i.exec(chunk);
    if (m) out.set(m[1], m[2].replace(/\s+/g, " ").trim());
  }
  return out;
}

function block(pattern: RegExp): string {
  const m = pattern.exec(CSS);
  expect(m, `no encontré el bloque ${pattern}`).not.toBeNull();
  return m![1];
}

const theme = declarations(block(/^@theme \{([\s\S]*?)^\}/m));
const themeInline = declarations(block(/^@theme inline \{([\s\S]*?)^\}/m));
const root = declarations(block(/^:root \{([\s\S]*?)^\}/m));
const darkClass = declarations(block(/^\.dark \{([\s\S]*?)^\}/m));
const printReset = declarations(
  block(
    /@media print \{\s*:root,\s*:root\.light,\s*:root\.dark,\s*:root:not\(\.light\):not\(\.dark\) \{([\s\S]*?)^ {2}\}/m,
  ),
);

function splitTopLevelComma(value: string): [string, string | null] {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (value[i] === "," && depth === 0) return [value.slice(0, i), value.slice(i + 1)];
  }
  return [value, null];
}

function resolveVar(value: string, scope: Map<string, string>, depth = 0): string {
  const trimmed = value.trim();
  if (depth > 30) throw new Error(`ciclo de var() resolviendo ${value}`);
  if (!trimmed.startsWith("var(")) return trimmed;
  const inner = trimmed.slice(4, trimmed.lastIndexOf(")"));
  const [name, fallback] = splitTopLevelComma(inner);
  const key = name.trim();
  if (scope.has(key)) return resolveVar(scope.get(key)!, scope, depth + 1);
  if (fallback !== null) return resolveVar(fallback, scope, depth + 1);
  throw new Error(`${key} no está definido y no tiene fallback`);
}

const merge = (...maps: Map<string, string>[]) => new Map(maps.flatMap((m) => [...m]));
/** El peor caso: el usuario estaba en dark y mandó a imprimir. */
const PRINT_SCOPE = merge(theme, themeInline, root, darkClass, printReset);
const c = (token: string) => resolveVar(`var(${token})`, PRINT_SCOPE);
const ratio = (a: string, b: string) => Math.round(wcagContrast(a, b) * 100) / 100;

/* ══════════════════════════════════════════════════════════════════════════
 * 1. El bloque @media print de globals.css
 * ═════════════════════════════════════════════════════════════════════════ */

/** El único `{ display: none }` del bloque print: su lista de selectores. */
const listaDisplayNone = (() => {
  const print = CSS.slice(CSS.indexOf("@media print"));
  const m = /([^{}]+)\{\s*display:\s*none;\s*\}/.exec(print);
  expect(m, "el bloque print ya no tiene una lista de `display: none`").not.toBeNull();
  return m![1];
})();

describe("@media print — esconde chrome, nunca contenido (defecto [12], regresión)", () => {
  it("NINGÚN rol de ARIA se usa como proxy de 'esto es decoración'", () => {
    // `[role="status"]` y `[aria-live]` borraban la respuesta del asistente, el
    // veredicto del verificador y el comprobante de impulso — también en light.
    expect(listaDisplayNone).not.toMatch(/\[role\s*=\s*["']?status/);
    expect(listaDisplayNone).not.toMatch(/\[aria-live/);
  });

  it("los nodos con role=status / aria-live que hoy son CONTENIDO siguen existiendo", () => {
    // Si alguien vuelve a meter el selector, estos archivos son los que se apagan.
    const contenidoVivo = [
      "components/assistant/assistant-message.tsx",
      "components/escudo/verificador-form.tsx",
      "app/(app)/impulsar/[listingId]/page.tsx",
      "app/(app)/perfil/verificar/resultado/page.tsx",
    ];
    for (const archivo of contenidoVivo) {
      const src = readFileSync(resolve(SRC, archivo), "utf8");
      expect(src, `${archivo} ya no anuncia su resultado`).toMatch(/role="status"|aria-live/);
    }
  });

  it("el chrome se esconde por selector de tipo o por `.cl-print-hide`, y nada más", () => {
    const selectores = listaDisplayNone
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(selectores).toEqual([
      "header:not(main header)",
      "nav",
      "dialog",
      '[role="dialog"]',
      "button",
      '[role="button"]',
      ".cl-print-hide",
      ".skeleton",
    ]);
  });

  it("`.cl-print-fill` fuerza el relleno con print-color-adjust (y su prefijo)", () => {
    expect(CSS).toMatch(
      /\.cl-print-fill \{\s*-webkit-print-color-adjust: exact;\s*print-color-adjust: exact;\s*\}/,
    );
  });

  it("el bloque print sigue DESPUÉS de los dos caminos a dark (empate de specificity)", () => {
    // `.dark` y `@media (prefers-color-scheme: dark) :root:not(.light):not(.dark)`
    // comparten selector con el bloque print: gana el último en orden de fuente.
    const iDark = CSS.indexOf("\n.dark {");
    const iMedia = CSS.indexOf("@media (prefers-color-scheme: dark)");
    const iPrint = CSS.indexOf("@media print");
    const iForced = CSS.indexOf("@media (forced-colors: active)");
    expect(iDark).toBeGreaterThan(0);
    expect(iPrint).toBeGreaterThan(iDark);
    expect(iPrint).toBeGreaterThan(iMedia);
    expect(iForced).toBeGreaterThan(iPrint);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Por qué la familia `on-*` necesita un hook: la medición
 * ═════════════════════════════════════════════════════════════════════════ */

describe("las tintas `on-*` contra el papel (medido con culori sobre los tokens reales)", () => {
  /** Tinta clara → sin su relleno impreso es invisible. Necesita `cl-print-hide|fill`. */
  const CLARAS = [
    "--color-brand-foreground",
    "--color-on-success",
    "--color-on-danger",
    "--color-on-info",
    "--color-on-surface-inverse",
    "--color-on-media",
  ] as const;

  it.each(CLARAS)("%s NO se lee sobre papel blanco: por eso necesita hook", (token) => {
    expect(ratio(c(token), PAPEL)).toBeLessThan(AA);
  });

  it("`on-warning` es la excepción, y no por casualidad: ya es tinta oscura", () => {
    // `--cl-light-on-warning: neutral-950` — el blanco sobre el ámbar daba 3.64:1.
    expect(ratio(c("--color-on-warning"), PAPEL)).toBeGreaterThanOrEqual(7);
  });

  it("oscurecer la tinta en print NO era la solución: rompe con 'Gráficos de fondo'", () => {
    // La alternativa barata era remapear `on-*` a `foreground` dentro de @media print.
    // Cuesta cero clases y funciona… hasta que el usuario tilda "Gráficos de fondo"
    // en el diálogo de impresión: ahí el relleno SÍ se imprime y la tinta oscura cae.
    const foreground = c("--color-foreground");
    for (const fill of ["--color-brand", "--color-danger", "--color-info"] as const) {
      expect(ratio(foreground, c(fill)), `foreground sobre ${fill}`).toBeLessThan(AA);
    }
    // `print-color-adjust: exact` conserva los ratios ya validados en pantalla.
    expect(ratio(c("--color-brand-foreground"), c("--color-brand"))).toBeGreaterThanOrEqual(AA);
    expect(ratio(c("--color-on-success"), c("--color-success"))).toBeGreaterThanOrEqual(AA);
    expect(ratio(c("--color-on-danger"), c("--color-danger"))).toBeGreaterThanOrEqual(AA);
  });

  it("el body imprime tinta oscura aunque el usuario venga de dark", () => {
    expect(ratio(c("--color-foreground"), PAPEL)).toBeGreaterThanOrEqual(7);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. El inventario: ningún portador de tinta `on-*` sin clasificar
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Un test que parsea JSX para adivinar el elemento que envuelve a cada clase es
 * una fachada: falla con `cn()`, con los helpers tipo `topicChipClass()` y con los
 * `<span>` anidados adentro de un `<button>`. Así que no adivina: acá está el
 * inventario COMPLETO, verificado a mano, de cada archivo que escribe una tinta
 * `on-*`, y por qué sobrevive al papel. Si alguien agrega, quita o mueve una a
 * otro archivo, este test explota y lo obliga a clasificarla.
 */
type Cobertura =
  | "control" // es (o vive dentro de) un <button>: el @media print ya lo esconde
  | "nav" // vive dentro de un <nav>: idem
  | "header" // vive dentro del <header> sticky, que NO cuelga de <main>: idem
  | "cl-print-hide" // hook explícito de globals.css
  | "cl-print-fill" // hook explícito: se imprime CON su relleno
  | "buttonVariants" // hereda `cl-print-hide` de la base del cva
  | "sobre <img>"; // el respaldo es un <img>, que el navegador SÍ imprime

/** Dónde se DEMUESTRA la cobertura. Por default, el mismo archivo que la escribe. */
type Entrada = {
  inks: string[];
  cobertura: Cobertura;
  prueba?: { archivo: string; contiene: string[] };
};

const INVENTARIO: Record<string, Entrada> = {
  // Botón "Quitar foto" del form de publicar producto — mismo patrón que
  // /publicar/publish-form.tsx (abajo): es un <button>, el @media print ya lo esconde.
  "src/app/(app)/marketplace/publicar/publish-form.tsx": {
    inks: ["text-on-media"],
    cobertura: "control",
  },
  "src/app/(app)/publicar/publish-form.tsx": { inks: ["text-on-media"], cobertura: "control" },
  // Hero de la landing: el respaldo es el <picture><img> de hero-backdrop, y un
  // <img> se imprime siempre (lo que el navegador omite es `background-*`). Fuera
  // de alcance de este defecto: el usuario está revisando el hero aparte.
  "src/app/(marketing)/page.tsx": {
    inks: Array<string>(6).fill("text-on-media"),
    cobertura: "sobre <img>",
    prueba: { archivo: "src/components/marketing/hero-backdrop.tsx", contiene: ["<img"] },
  },
  // Creator Marketplace: chips de categoría/urgente/disponibilidad flotando
  // sobre la foto del aviso o del portfolio (overlay de CardMedia) + el ícono
  // del fallback violeta — mismo motivo que product-card.tsx: se imprimen con su
  // velo (bg-media-scrim + cl-print-fill).
  "src/app/(app)/creadores/[id]/page.tsx": {
    inks: Array<string>(5).fill("text-on-media"),
    cobertura: "cl-print-fill",
  },
  // El feed de trabajos ya no muestra categorías (ni chips de filtro ni selector):
  // page.tsx dejó de escribir tinta on-* — por eso ya no está en el inventario.
  // Chip "Urgente" sobre la foto del aviso + el ícono del fallback violeta (el chip
  // de categoría se quitó: no se muestran categorías en Creadores).
  "src/components/creators/gig-card.tsx": {
    inks: ["text-on-media", "text-on-media"],
    cobertura: "cl-print-fill",
  },
  "src/components/creators/creator-card.tsx": {
    inks: ["text-on-media", "text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Botón "Quitar foto" del portfolio / de las fotos del aviso — es un <button>,
  // el @media print ya lo esconde (mismo patrón que los publish-form de arriba).
  "src/components/creators/creator-profile-form.tsx": {
    inks: ["text-on-media"],
    cobertura: "control",
  },
  "src/components/creators/gig-publish-form.tsx": {
    inks: ["text-on-media"],
    cobertura: "control",
  },
  "src/components/admin/admin-nav.tsx": { inks: ["text-brand-foreground"], cobertura: "nav" },
  // Único portador que no es control: escudo verde sobre el avatar.
  "src/components/auth/identity-badge.tsx": {
    inks: ["text-on-success"],
    cobertura: "cl-print-fill",
  },
  "src/components/feed/comment-composer.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  "src/components/feed/post-composer.tsx": { inks: ["text-on-media"], cobertura: "control" },
  // Dos flechas <button> + el contador "3 / 7", que se imprime con su velo.
  "src/components/listings/gallery.tsx": {
    inks: ["text-on-media", "text-on-media", "text-on-media"],
    cobertura: "cl-print-fill",
  },
  "src/components/marketing/guides-explorer.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  "src/components/marketing/language-toggle.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  // Ícono decorativo del banner "para dueños" de /marketplace — mismo hook que
  // IdentityBadge: escudo/megáfono claro sobre un relleno de acento sólido.
  "src/components/marketplace/owner-banner.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Chip de categoría flotando sobre la foto de la card de producto (overlay
  // de CardMedia) — mismo motivo que el chip de arriba.
  "src/components/marketplace/product-card.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Contador "2/4" de la galería del detalle de producto — mismo patrón que
  // listings/gallery.tsx: se imprime con su velo (bg-media-scrim + cl-print-fill).
  "src/components/marketplace/product-gallery.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-fill",
  },
  "src/components/messaging/composer.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  // Menú de la app (2026-07-20): el CTA "Publicar" y el contador de no leídas
  // viven en un panel montado por PORTAL en <body> — fuera de <main> y fuera
  // del <header>, así que ni `header:not(main header)` ni la regla de <button>
  // lo alcanzan. Cobertura explícita: el panel lleva `cl-print-hide` (es chrome:
  // en papel no significa nada). Reemplaza a la campana del header, borrada
  // junto con el rail de módulos.
  // Dos usos, y el inventario cuenta ocurrencias a propósito: el CTA "Publicar
  // algo" y el contador de no leídas de la fila de Notificaciones.
  "src/components/shell/app-menu.tsx": {
    inks: ["text-brand-foreground", "text-brand-foreground"],
    cobertura: "cl-print-hide",
  },
  "src/components/onboarding/onboarding-wizard.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  "src/components/shell/offline-banner.tsx": {
    inks: ["text-on-surface-inverse"],
    cobertura: "cl-print-hide",
  },
  "src/components/ui/button.tsx": {
    inks: ["text-brand-foreground", "text-on-danger"],
    cobertura: "buttonVariants",
  },
  // Primitivo CardMedia: la franja overlayBottom (bg-media-scrim + text-on-media)
  // se dibuja sobre el <img>/Image, que sí se imprime (el navegador omite el
  // background del velo, no la foto). Mismo criterio que el hero de la landing.
  "src/components/ui/card-media.tsx": {
    inks: ["text-on-media"],
    cobertura: "sobre <img>",
  },
};

/** Qué substring prueba cada cobertura cuando la entrada no trae `prueba` propia. */
const PRUEBA_POR_DEFECTO: Record<Cobertura, string[]> = {
  control: ["<button"],
  nav: ["<nav"],
  header: ["<header"],
  "cl-print-hide": ["cl-print-hide"],
  "cl-print-fill": ["cl-print-fill"],
  buttonVariants: ["cl-print-hide"],
  "sobre <img>": ["<img"],
};

const RE_INK =
  /\btext-(brand-foreground|on-success|on-danger|on-info|on-surface-inverse|on-media)\b/g;

/**
 * Borra comentarios conservando offsets. `src[i-1] !== ":"` deja pasar el `//` de
 * `https://`, que si no se comería el resto de la línea.
 */
function soloCodigo(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("/*", i)) {
      const fin = src.indexOf("*/", i + 2);
      const hasta = fin < 0 ? src.length : fin + 2;
      out += src.slice(i, hasta).replace(/[^\n]/g, " ");
      i = hasta;
      continue;
    }
    if (src.startsWith("//", i) && src[i - 1] !== ":") {
      const salto = src.indexOf("\n", i);
      const hasta = salto < 0 ? src.length : salto;
      out += " ".repeat(hasta - i);
      i = hasta;
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

function archivosTsx(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const full = join(dir, nombre);
    if (statSync(full).isDirectory()) archivosTsx(full, acc);
    else if (/\.tsx$/.test(nombre) && !/\.test\.tsx$/.test(nombre)) acc.push(full);
  }
  return acc;
}

const encontrado: Record<string, string[]> = {};
for (const archivo of archivosTsx(SRC)) {
  const hits = [...soloCodigo(readFileSync(archivo, "utf8")).matchAll(RE_INK)].map((m) => m[0]);
  if (hits.length) encontrado[relative(ROOT, archivo).split(sep).join("/")] = hits.sort();
}

describe("inventario de tintas `on-*` — nadie las escribe sin decir cómo sobrevive al papel", () => {
  it("los archivos que las escriben son EXACTAMENTE los del inventario", () => {
    const esperado = Object.fromEntries(
      Object.entries(INVENTARIO).map(([f, { inks }]) => [f, [...inks].sort()]),
    );
    expect(encontrado).toEqual(esperado);
  });

  it.each(Object.entries(INVENTARIO))(
    "%s: la cobertura declarada existe de verdad en el código",
    (archivo, entrada) => {
      const prueba = entrada.prueba ?? {
        archivo,
        contiene: PRUEBA_POR_DEFECTO[entrada.cobertura],
      };
      const fuente = readFileSync(resolve(ROOT, prueba.archivo), "utf8");
      for (const aguja of prueba.contiene) {
        expect(fuente, `${prueba.archivo} debería probar "${entrada.cobertura}"`).toContain(aguja);
      }
    },
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. buttonVariants: el <a> con pinta de botón también es chrome
 * ═════════════════════════════════════════════════════════════════════════ */

describe("buttonVariants lleva el hook — el CTA de /guias/[slug] es un <a>, no un <button>", () => {
  it("la base lo emite en los cuatro variants", () => {
    for (const variant of ["primary", "secondary", "outline", "ghost", "danger"] as const) {
      expect(buttonVariants({ variant })).toContain("cl-print-hide");
    }
  });

  it("`primary` sigue siendo `bg-brand text-brand-foreground`: sin hook, 1.00:1 en papel", () => {
    expect(buttonVariants({ variant: "primary" })).toContain("bg-brand");
    expect(buttonVariants({ variant: "primary" })).toContain("text-brand-foreground");
    expect(ratio(c("--color-brand-foreground"), PAPEL)).toBe(1);
  });

  it("tailwind-merge no se lo come al componer clases en el call site", () => {
    // `cn(buttonVariants({...}), "w-full")` y `cn(…, "flex")` son patrones reales:
    // el segundo pisa `inline-flex`, y el hook tiene que seguir ahí igual.
    expect(cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")).toContain(
      "cl-print-hide",
    );
    expect(cn(buttonVariants({ variant: "outline" }), "flex border-on-media/40")).toContain(
      "cl-print-hide",
    );
  });
});
