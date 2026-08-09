import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * GUARDA DE REGRESIÓN — un módulo `"use server"` solo puede exportar funciones
 * async.
 *
 * Exportar de ahí un helper puro (aunque sea una función de 4 líneas sin I/O)
 * hace que Next tire "Server Actions must be async functions" y **rompe el build
 * entero**. No lo agarra `tsc`, no lo agarra vitest importando el módulo: solo se
 * ve al correr `npm run build` o al renderizar la página.
 *
 * Los tipos (`export type` / `export interface`) sí se pueden exportar: se
 * borran al compilar, nunca llegan al runtime.
 *
 * ## Por qué este archivo vive en `src/test/` y barre TODO `src/`
 *
 * Antes había una guarda igual pero acotada a `src/app/admin/`, nacida de un
 * caso real (`toModuleColumns` en `dominio/actions.ts`, 2026-07-27). El alcance
 * angosto se pagó: el 2026-08-08 el mismo bug volvió en
 * `src/app/(app)/perfil/actions.ts` (`export function ageFromBirthdate`) y rompió
 * el build — exactamente lo que la guarda existía para prevenir, en un directorio
 * que no miraba. Una guarda que cubre una sola carpeta le enseña al equipo que el
 * problema es de esa carpeta, y no lo es: es de cualquier módulo `"use server"`
 * del repo.
 */

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

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

/** Todo módulo de `src/` que declara "use server" en la primera línea útil. */
const serverModules = collectFiles(SRC_DIR)
  .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
  .map((file) => ({ file, source: readFileSync(file, "utf8") }))
  .filter(({ source }) => /^\s*["']use server["'];/m.test(source));

describe('módulos "use server" de todo src/', () => {
  it("hay al menos uno que revisar (si no, el test se volvió decorativo)", () => {
    expect(serverModules.length).toBeGreaterThan(0);
  });

  it("cubre módulos fuera de src/app/admin (si no, volvimos al alcance angosto)", () => {
    const fueraDeAdmin = serverModules.filter(
      ({ file }) => !file.includes(join("app", "admin")),
    );
    expect(fueraDeAdmin.length).toBeGreaterThan(0);
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
