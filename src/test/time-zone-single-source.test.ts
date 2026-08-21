import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE } from "@/lib/utils";

/**
 * GUARDA DE REGRESIÓN — la zona horaria se escribe UNA sola vez.
 *
 * `DEFAULT_TIME_ZONE` (src/lib/utils.ts) es la fuente de verdad única. Cuando
 * alguien vuelve a tipear el literal `"America/New_York"` en su pantalla, el
 * repo queda con dos zonas que hay que acordarse de mover juntas — y no se
 * mueven juntas. Ya pasó una vez: `ADMIN_TIME_ZONE` tenía su propio valor
 * literal y el `formatDate` global se quedó SIN zona fijada, así que el mismo
 * instante salía distinto en el panel que en el resto de la app (está contado
 * en el comentario de src/components/admin/format.ts).
 *
 * Este test no mira cómo se ve una fecha: mira que no vuelva a haber una
 * segunda definición de la zona. Es la única forma de que el arreglo anterior
 * no se deshaga solo.
 *
 * Lo que SÍ está permitido:
 *  - `src/lib/utils.ts`, que es donde vive la constante.
 *  - `timeZone: "UTC"` explícito — no es "la zona de la comunidad" sino la
 *    única zona que devuelve el mismo día calendario que entró (fechas sin
 *    hora: `checked_at` de las guías, días `YYYY-MM-DD` de las métricas).
 *  - los tests, que rotan zonas a propósito para probar justamente esto.
 */

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

/** El literal que NO puede aparecer fuera de su único dueño. */
const ZONE_LITERAL = DEFAULT_TIME_ZONE;

/** Dueño legítimo de la constante. */
const OWNER = join("lib", "utils.ts");

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

const sourceFiles = collectFiles(SRC_DIR).filter(
  (file) =>
    !file.endsWith(".test.ts") &&
    !file.endsWith(".test.tsx") &&
    !file.endsWith(OWNER),
);

describe("zona horaria: una sola definición en todo el repo", () => {
  it("hay archivos que revisar (si no, el test se volvió decorativo)", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  /**
   * Timeout explícito (2026-08-21): este caso LEE EL REPO ENTERO desde disco,
   * archivo por archivo. Aislado tarda ~650 ms, pero corriendo dentro de la
   * suite completa —con el resto de los workers peleando el mismo disco— se
   * pasaba de los 5 s por default y tiraba un rojo que no era un rojo. Pasó
   * tres veces en una sola sesión, siempre en verde al re-correrlo solo.
   *
   * Un test que falla por la máquina y no por el código es peor que no
   * tenerlo: enseña a ignorar la suite. 30 s no afloja lo que verifica —el
   * assert es idéntico—, sólo deja de competir con el I/O de los demás.
   */
  it(`ningún módulo vuelve a escribir "${ZONE_LITERAL}" a mano`, { timeout: 30_000 }, () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        // Solo código: un comentario que NOMBRA la zona (para explicar por qué
        // está donde está) no es una segunda definición.
        const withoutComment = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        if (withoutComment.includes(ZONE_LITERAL)) {
          offenders.push(`${file.slice(SRC_DIR.length)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      `la zona se importa de @/lib/utils (DEFAULT_TIME_ZONE), no se vuelve a tipear: ${offenders.join(" · ")}`,
    ).toEqual([]);
  });
});
