import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * =============================================================================
 * EL LÍMITE `"use client"` DE LA BANDEJA — test de contrato, no de runtime
 * =============================================================================
 *
 * Bug que ancla (producción, agosto 2026): `/notificaciones` mostraba el error
 * boundary —"No pudimos cargar esta pantalla"— en cada visita. La página es un
 * Server Component y hacía dos cosas con valores que nacían dentro de
 * `category-tabs.tsx`, que es `"use client"`:
 *
 *     id={INBOX_PANEL_ID}
 *     aria-labelledby={inboxTabId(query.tab)}
 *
 * `"use client"` no marca "esto corre en el navegador": marca un LÍMITE de
 * módulo. Cuando el servidor importa de un archivo así, no recibe los valores —
 * recibe referencias al cliente. `INBOX_PANEL_ID` dejaba de ser
 * "notificaciones-panel" y pasaba a ser una función, y la llamada a
 * `inboxTabId()` tiraba durante el render:
 *
 *     Attempted to call inboxTabId() from the server but inboxTabId is on the
 *     client. It's not possible to invoke a client function from the server, it
 *     can only be rendered as a Component or passed to props of a Client
 *     Component.
 *
 * POR QUÉ ESTE TEST ES ESTÁTICO. Un test de render no puede atrapar esto: el
 * límite lo construye el bundler de React Server Components, y bajo Vitest
 * `inboxTabId` es una función común y corriente que anda perfecto. El bug sólo
 * existe cuando el grafo del servidor y el del cliente están separados de
 * verdad. Lo que sí es verificable siempre es la REGLA: de un módulo `"use
 * client"`, un Server Component sólo puede importar COMPONENTES, para
 * renderizarlos.
 *
 * Y SIGUE LOS BARRILES a propósito. `page.tsx` no importaba de
 * `./category-tabs` sino de `@/components/notifications`, un `index.ts` sin
 * directiva: el barril escondía de qué archivo venía cada nombre. Un chequeo que
 * mire sólo el especificador literal no habría visto nada. Por eso cada binding
 * se persigue a través de los `export { ... } from "..."` hasta el archivo que
 * lo declara.
 *
 * ALCANCE: los archivos de la bandeja. Las importaciones se resuelven a donde
 * sea que vivan (incluido `@/components/ui`), así que si mañana alguien vuelve
 * client un módulo del que esta pantalla toma un helper, también se cae acá.
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));

const ROOTS = [
  path.join(SRC, "app", "(app)", "notificaciones"),
  path.join(SRC, "components", "notifications"),
];

const EXTENSIONS = [".ts", ".tsx"];

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else if (EXTENSIONS.includes(path.extname(entry)) && !/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

const sourceCache = new Map<string, string>();

function read(file: string): string {
  let source = sourceCache.get(file);
  if (source === undefined) {
    source = readFileSync(file, "utf8");
    sourceCache.set(file, source);
  }
  return source;
}

/**
 * La directiva tiene que ser la PRIMERA sentencia, pero puede venir detrás de
 * comentarios — varios archivos del repo abren con un docblock largo.
 */
function isClientModule(file: string): boolean {
  let rest = read(file).replace(/^﻿/, "");
  for (;;) {
    const trimmed = rest.replace(/^\s+/, "");
    if (trimmed.startsWith("//")) {
      const nl = trimmed.indexOf("\n");
      if (nl === -1) return false;
      rest = trimmed.slice(nl + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      if (end === -1) return false;
      rest = trimmed.slice(end + 2);
      continue;
    }
    rest = trimmed;
    break;
  }
  return /^(["'])use client\1/.test(rest);
}

/** `@/x` y las relativas; los paquetes de node_modules quedan afuera. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // no existe; probamos la siguiente extensión
    }
  }
  return null;
}

type Imported = { name: string; local: string; specifier: string };

const IMPORT_RE = /import\s+([^;'"]*?)\s*from\s*["']([^"']+)["']/g;

/** Los `import type` y los `type X` sueltos no existen en runtime: no cruzan
 *  ningún límite y por eso no se miran. */
function importsOf(source: string): Imported[] {
  const out: Imported[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const clause = match[1].trim();
    const specifier = match[2];
    if (/^type\b/.test(clause)) continue;

    const braces = /\{([\s\S]*)\}/.exec(clause);
    if (braces) {
      for (const raw of braces[1].split(",")) {
        const entry = raw.trim();
        if (!entry || /^type\b/.test(entry)) continue;
        const [name, local] = entry.split(/\s+as\s+/).map((part) => part.trim());
        out.push({ name, local: local ?? name, specifier });
      }
    }

    const head = clause.replace(/\{[\s\S]*\}/, "").replace(/,\s*$/, "").trim();
    if (head.startsWith("* as")) {
      out.push({ name: "*", local: head.slice(4).trim(), specifier });
    } else if (head && !head.startsWith("{")) {
      out.push({ name: "default", local: head, specifier });
    }
  }
  return out;
}

const REEXPORT_RE = /export\s+\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g;

/**
 * De qué archivo sale REALMENTE un nombre, atravesando los barriles. Devuelve
 * el archivo que lo declara (o el primer `"use client"` que se cruza, que es
 * donde el límite ya quedó puesto).
 */
function originOf(name: string, file: string, seen = new Set<string>()): string {
  if (isClientModule(file) || seen.has(file)) return file;
  seen.add(file);

  for (const match of read(file).matchAll(REEXPORT_RE)) {
    for (const raw of match[1].split(",")) {
      const entry = raw.trim();
      if (!entry || /^type\b/.test(entry)) continue;
      const [source, exposed] = entry.split(/\s+as\s+/).map((part) => part.trim());
      if ((exposed ?? source) !== name) continue;
      const next = resolveSpecifier(match[2], file);
      return next ? originOf(source, next, seen) : file;
    }
  }
  return file;
}

/**
 * Un componente: lo único que el servidor puede sacar de un módulo cliente.
 *
 * PascalCase de verdad — mayúscula inicial Y alguna minúscula. Pedir sólo la
 * mayúscula dejaba pasar `INBOX_PANEL_ID`, que era la mitad de este mismo bug:
 * una constante en SCREAMING_CASE no es un componente y desde el servidor
 * tampoco era su string, era la referencia al cliente puesta en un `id=`.
 */
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) && /[a-z]/.test(name);
}

describe("límite servidor/cliente de la bandeja de notificaciones", () => {
  const serverModules = ROOTS.flatMap(walk).filter((file) => !isClientModule(file));

  it("encuentra los archivos de la bandeja", () => {
    expect(serverModules.length).toBeGreaterThan(0);
    expect(serverModules).toContain(path.join(ROOTS[0], "page.tsx"));
  });

  it("ningún Server Component importa de un módulo `use client` algo que no sea un componente", () => {
    const violations: string[] = [];

    for (const file of serverModules) {
      for (const { name, local, specifier } of importsOf(read(file))) {
        const target = resolveSpecifier(specifier, file);
        if (!target) continue;

        const origin = originOf(name, target, new Set());
        if (!isClientModule(origin)) continue;
        if (name !== "*" && isComponentName(name)) continue;

        violations.push(
          `${path.relative(SRC, file)} importa \`${local}\` de "${specifier}", ` +
            `que sale de ${path.relative(SRC, origin)} — un módulo "use client". ` +
            `En el servidor eso no es el valor sino una referencia al cliente: ` +
            `usarlo tira "Attempted to call ${name}() from the server". ` +
            `Movelo a un módulo sin la directiva (por ejemplo lib/notifications/).`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("los ids del patrón tabs viven fuera del límite cliente", () => {
    const href = path.join(SRC, "lib", "notifications", "href.ts");
    const source = read(href);

    expect(isClientModule(href)).toBe(false);
    expect(source).toMatch(/export const INBOX_PANEL_ID\b/);
    expect(source).toMatch(/export const inboxTabId\b/);

    // Y que no queden dos fuentes de verdad: la que era su casa vieja ahora los
    // importa, no los declara.
    const tabs = read(path.join(SRC, "components", "notifications", "category-tabs.tsx"));
    expect(tabs).not.toMatch(/export const (INBOX_PANEL_ID|inboxTabId)\b/);
  });
});
