import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/app/admin/dominio/modules";

/**
 * El seed y la app tienen que llamar a los módulos de la MISMA manera.
 *
 * Este test existe porque no se cumplió: `scripts/seed.mjs` sembraba
 * `properties`, `businesses`, `professionals`, `events`, `jobs` y `guides`
 * mientras la app leía `propiedades`, `negocios`, `profesionales`, `eventos`,
 * `empleos`… Ninguna clave matcheaba, así que un tenant recién sembrado no tenía
 * decisión guardada para NINGUNA sección — y el día que el default de la clave
 * ausente fuera "oculto", esa comunidad se quedaba sin app entera (le pasó a
 * `comunidadlatina`, que llegó a producción con las claves en inglés).
 *
 * El seed es un `.mjs` que corre con dotenv y hace `process.exit` si le faltan
 * variables de entorno: no se puede importar desde un test. Por eso se lee como
 * TEXTO y se compara la lista declarada, que para eso está en una sola const con
 * un nombre estable. Si alguien la reformatea, el test lo dice explícitamente en
 * vez de pasar en verde sin haber comparado nada.
 */
describe("scripts/seed.mjs ↔ MODULE_KEYS", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "seed.mjs"), "utf8");

  it("declara su lista de módulos en una const legible", () => {
    expect(
      /const MODULE_KEYS = \[[\s\S]*?\]/.test(source),
      "seed.mjs ya no declara `const MODULE_KEYS = [...]` — este test no puede comparar nada. " +
        "Volvé a esa forma o reescribí el test, pero no lo dejes pasando de largo.",
    ).toBe(true);
  });

  it("siembra exactamente las claves canónicas, sin inventar ni olvidar ninguna", () => {
    const block = source.match(/const MODULE_KEYS = \[([\s\S]*?)\]/)?.[1] ?? "";
    const seeded = [...block.matchAll(/['"]([a-z_]+)['"]/g)].map((match) => match[1]);

    expect(seeded.length).toBeGreaterThan(0);
    expect([...seeded].sort()).toEqual([...MODULE_KEYS].sort());
  });
});
