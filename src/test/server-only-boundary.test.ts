import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * =============================================================================
 * `server-only` NO PUEDE LLEGAR AL BUNDLE DEL CLIENTE — test de grafo
 * =============================================================================
 *
 * Bug que ancla (2026-08-24): el build de producción se cayó entero con
 *
 *     You're importing a module that depends on "server-only".
 *     ./src/components/resenas/queries.ts
 *     ./src/components/resenas/index.ts
 *     ./src/components/marketplace/store-card.tsx
 *     ./src/components/marketplace/index.ts
 *     ./src/app/(app)/marketplace/publicar/publish-form.tsx
 *
 * Nadie importó nunca `queries.ts` desde el cliente. Lo que pasó es que
 * `store-card.tsx` tomó `Estrellas` del BARRIL `@/components/resenas`, y ese
 * barril reexporta —en la misma línea de siempre, sin que nadie la mirara—
 * `fetchResenasDeAviso` desde un archivo que abre con `import "server-only"`.
 * Webpack no importa nombres, importa MÓDULOS: alcanza con que el barril esté
 * en el camino para que todo lo que reexporta entre al grafo. Como el barril de
 * marketplace exporta esa tarjeta, y un formulario `"use client"` importa de
 * ese barril, `server-only` terminó del lado del navegador.
 *
 * POR QUÉ NINGÚN TEST LO VEÍA. Bajo Vitest los 4.347 tests pasaban y `tsc`
 * daba cero: no es un error de tipos ni de runtime en jsdom, es una propiedad
 * del GRAFO que arma el bundler. La única forma de verlo antes del build es
 * recorrer el grafo, que es lo que hace este archivo.
 *
 * ES LA SEGUNDA VEZ EN EL MISMO DÍA que un barril esconde de dónde sale algo y
 * rompe un límite. La primera fue al revés —un Server Component tomando un
 * valor de un módulo `"use client"`, ver
 * `components/notifications/client-boundary.test.ts`—. Aquel test cuida una
 * dirección; éste cuida la otra.
 *
 * LA REGLA: desde cualquier archivo `"use client"`, ningún camino de imports
 * puede terminar en un módulo con `import "server-only"`.
 *
 * ARREGLO CUANDO ESTO SE PONE ROJO: importá el módulo puntual en vez del
 * barril (`@/components/resenas/estrellas`, no `@/components/resenas`), o sacá
 * la función de servidor del barril de componentes. Envolver el import en un
 * `import type` también sirve si de verdad sólo necesitás el tipo — los
 * `import type` se borran al compilar y por eso este test los ignora.
 */

const SRC = fileURLToPath(new URL("../", import.meta.url));

const EXTENSIONS = [".ts", ".tsx"];

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else if (EXTENSIONS.includes(path.extname(entry))) {
      found.push(full);
    }
  }
  return found;
}

/** `@/x` y rutas relativas → archivo real. `null` si es una dependencia externa. */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(SRC, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null; // paquete de node_modules: no es nuestro grafo
  }

  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => path.join(base, "index" + ext)),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // no existe, seguimos probando
    }
  }
  return null;
}

/**
 * Saca comentarios antes de escanear.
 *
 * No es prolijidad: sin esto el test daba FALSO POSITIVO. Un docblock que
 * menciona la palabra `import type` entre backticks no lo excluía el
 * `(?!type\s)` —porque lo que sigue es un backtick, no un espacio— y el
 * `[\s\S]*?` seguía buscando hasta encontrar el `from` de la línea siguiente,
 * inventando un import que no existe. Lo detectó un agente al que este test le
 * marcó su propio comentario.
 *
 * Los literales de string quedan (nadie escribe un `from "..."` adentro de uno
 * y este barrido sólo puede errar de más, no de menos).
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Especificadores importados por un archivo, SIN los `import type` (se borran
 * al compilar, así que no entran al grafo del bundler) y sin los imports que
 * traen sólo tipos entre llaves.
 */
function importSpecifiers(rawSource: string): string[] {
  const source = stripComments(rawSource);
  const specifiers: string[] = [];
  const importRe = /import\s+(?!type\s)([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source)) !== null) {
    specifiers.push(match[2]);
  }
  // `import "server-only"` y otros side-effect imports.
  const bareRe = /import\s+["']([^"']+)["']/g;
  while ((match = bareRe.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  // `export { x } from "..."` — el barril también arrastra el módulo.
  const reexportRe = /export\s+(?!type\s)[\s\S]*?\s*from\s*["']([^"']+)["']/g;
  while ((match = reexportRe.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']/m;
const USE_CLIENT_RE = /^\s*["']use client["']/;

/**
 * `"use server"` CORTA el recorrido, y no es una excepción de conveniencia.
 *
 * Cuando un componente cliente importa un módulo de server actions, no recibe
 * el módulo: recibe un stub que hace un POST al servidor. El código de esa
 * action —y todo lo que ella importe, `server-only` incluido— se queda del lado
 * del servidor. Es exactamente el mecanismo que Next ofrece para cruzar el
 * límite sin romperlo.
 *
 * Sin esta regla el test grita por media app: `identity-switcher.tsx` llama a
 * `cambiarIdentidad`, `follow-button.tsx` llama a las actions de seguir, y las
 * dos cadenas terminan en `lib/tenant/guard.ts`. Todas correctas.
 */
const USE_SERVER_RE = /^\s*["']use server["']/;

const allFiles = walk(SRC);
const sources = new Map<string, string>();
for (const file of allFiles) sources.set(file, readFileSync(file, "utf8"));

const clientEntrypoints = allFiles.filter((file) => USE_CLIENT_RE.test(sources.get(file) ?? ""));

/** Camino desde un `"use client"` hasta un módulo `server-only`, o `null`. */
function findServerOnlyPath(entry: string): string[] | null {
  const seen = new Set<string>([entry]);
  const queue: { file: string; trail: string[] }[] = [{ file: entry, trail: [entry] }];

  while (queue.length > 0) {
    const { file, trail } = queue.shift()!;
    const source = sources.get(file);
    if (source === undefined) continue;

    if (file !== entry && SERVER_ONLY_RE.test(source)) return trail;

    // Frontera legítima: lo que cuelga de una server action no viaja al cliente.
    if (file !== entry && USE_SERVER_RE.test(source)) continue;

    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveImport(file, specifier);
      if (resolved === null || seen.has(resolved)) continue;
      seen.add(resolved);
      queue.push({ file: resolved, trail: [...trail, resolved] });
    }
  }
  return null;
}

const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, "/");

describe('ningún grafo "use client" alcanza un módulo server-only', () => {
  it("hay archivos client para revisar (si esto falla, el barrido está roto)", () => {
    expect(clientEntrypoints.length).toBeGreaterThan(20);
  });

  it("ningún archivo client importa, ni por barril, algo con server-only", () => {
    const ofensas: string[] = [];
    for (const entry of clientEntrypoints) {
      const trail = findServerOnlyPath(entry);
      if (trail !== null) ofensas.push(trail.map(rel).join("\n    → "));
    }

    expect(
      ofensas,
      ofensas.length === 0
        ? ""
        : `Estos archivos "use client" llegan a un módulo con import "server-only".\n` +
            `El build de producción se cae con esto, aunque tsc y los tests pasen.\n` +
            `Importá el módulo puntual en vez del barril, o sacá la función de\n` +
            `servidor del barril de componentes.\n\n` +
            ofensas.join("\n\n"),
    ).toEqual([]);
    // 30 s y no los 5 de default: esto recorre el grafo de imports de TODO
    // `src/` (más de mil archivos). Solo tarda ~3 s, pero corriendo junto al
    // resto de la suite en paralelo se pasaba de los 5 y fallaba por reloj, no
    // por una ofensa real — un rojo que miente es peor que no tener el test.
  }, 30_000);
});
