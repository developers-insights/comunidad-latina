import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * GUARDA DE REGRESIÓN — un módulo `"use server"` solo puede exportar funciones
 * async.
 *
 * Exportar de ahí un helper puro (aunque sea una función de 4 líneas sin I/O)
 * hace que Next tire "Server Actions must be async functions" y **rompe la ruta
 * entera en runtime**. No lo agarra `tsc`, no lo agarra vitest importando el
 * módulo: solo se ve al renderizar la página en el browser. Pasó de verdad con
 * `toModuleColumns` en dominio/actions.ts (2026-07-27) — de ahí este test.
 *
 * Los tipos (`export type` / `export interface`) sí se pueden exportar: se
 * borran al compilar, nunca llegan al runtime.
 */

const ADMIN_DIR = fileURLToPath(new URL(".", import.meta.url));

function collectFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

/** Archivos del panel admin que declaran "use server" en la primera línea útil. */
const serverModules = collectFiles(ADMIN_DIR)
  .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
  .map((file) => ({ file, source: readFileSync(file, "utf8") }))
  .filter(({ source }) => /^\s*["']use server["'];/m.test(source));

describe('módulos "use server" del panel admin', () => {
  it("hay al menos uno que revisar (si no, el test se volvió decorativo)", () => {
    expect(serverModules.length).toBeGreaterThan(0);
  });

  it.each(serverModules.map(({ file }) => file))(
    "%s exporta solo funciones async (o tipos)",
    (file) => {
      const source = serverModules.find((entry) => entry.file === file)!.source;

      const offenders = source
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => line.startsWith("export"))
        .filter(
          ({ line }) =>
            !line.startsWith("export async function") &&
            !line.startsWith("export type") &&
            !line.startsWith("export interface"),
        );

      expect(
        offenders.map(({ line, number }) => `${number}: ${line}`),
        'un archivo "use server" solo puede exportar funciones async; mové los helpers puros a su propio módulo',
      ).toEqual([]);
    },
  );
});
