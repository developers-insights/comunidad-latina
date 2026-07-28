import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * INVARIANTE DE ROUTING: ningún `loading.tsx` puede colgar de un segmento que
 * tenga —en él o debajo— una ruta que llame `notFound()`.
 *
 * Por qué, con la evidencia (build de producción, 2026-07-27):
 *
 * Un `loading.tsx` es un `<Suspense>` alrededor de su segmento y de TODO lo que
 * cuelga de él. Cuando el fallback se renderiza, la respuesta EMPIEZA A
 * STREAMEARSE: los headers ya salieron y el status queda clavado en 200. Un
 * `notFound()` posterior sigue pintando la UI de "no encontrado" y el
 * `<meta name="robots" content="noindex">`, pero YA NO PUEDE devolver 404.
 * Es el "soft 404" que documenta Next:
 *   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md
 *   §Status Codes → "the status code of the response cannot be updated"
 *                   "Place notFound() before those boundaries"
 *
 * Este repo tenía un `src/app/loading.tsx` (raíz) que envolvía la app entera, y
 * por eso las 21 rutas con `notFound()` devolvían 200. Medido sobre `next start`,
 * mismo commit, quitando sólo ese archivo: /eventos/lo-que-sea 200 → 404.
 *
 * El test recorre el árbol REAL de `src/app`, así que cubre las rutas que hay
 * hoy y las que se agreguen mañana: si alguien pone un `loading.tsx` de más (o
 * agrega un `notFound()` bajo uno existente), falla acá y no en producción.
 *
 * Cómo arreglarlo si este test falla: aislá la lista en un route group
 * `(lista)/` —hermano del `[id]/`— y poné ahí el `loading.tsx`. El route group
 * no cambia la URL pero sí el árbol de segmentos, así que el boundary deja de
 * cubrir al detalle. Ejemplo vivo: `src/app/(app)/eventos/(lista)/loading.tsx`.
 */

// `new URL(".")` termina en separador; normalizamos porque todo el test compara
// prefijos de path (sin esto, `dir + sep` queda con separador doble y el
// boundary de la RAÍZ no matchea a ninguna ruta — es decir, el test pasaría
// justo en el caso que motivó escribirlo).
const APP_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)));

type RouteFile = { file: string; dir: string; route: string };

/** URL pública de un archivo de ruta: sin `src/app`, sin route groups. */
function routeOf(dir: string): string {
  const rel = path.relative(APP_DIR, dir);
  const segments = rel
    .split(path.sep)
    .filter((s) => s.length > 0 && !s.startsWith("("));
  return "/" + segments.join("/");
}

function collect(): { notFoundRoutes: RouteFile[]; loadingBoundaries: RouteFile[] } {
  const notFoundRoutes: RouteFile[] = [];
  const loadingBoundaries: RouteFile[] = [];

  (function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name === "loading.tsx") {
        loadingBoundaries.push({ file: full, dir, route: routeOf(dir) });
        continue;
      }
      // `notFound()` puede vivir en la página o en el layout del segmento.
      if (entry.name === "page.tsx" || entry.name === "layout.tsx") {
        if (/\bnotFound\(\)/.test(readFileSync(full, "utf8"))) {
          notFoundRoutes.push({ file: full, dir, route: routeOf(dir) });
        }
      }
    }
  })(APP_DIR);

  return { notFoundRoutes, loadingBoundaries };
}

const { notFoundRoutes, loadingBoundaries } = collect();

/** ¿`ancestor` es el mismo directorio o uno por encima de `descendant`? */
function covers(ancestor: string, descendant: string): boolean {
  return ancestor === descendant || descendant.startsWith(ancestor + path.sep);
}

function boundariesOver(routeDir: string): string[] {
  return loadingBoundaries
    .filter((b) => covers(b.dir, routeDir))
    .map((b) => path.relative(APP_DIR, b.file).split(path.sep).join("/"));
}

describe("boundaries de loading vs. rutas que devuelven 404", () => {
  it("el árbol de rutas se leyó de verdad (guard contra un walk vacío)", () => {
    expect(notFoundRoutes.length).toBeGreaterThan(15);
    expect(loadingBoundaries.length).toBeGreaterThan(0);
  });

  // Ancla por-ruta: cada ruta que hace notFound() es su propio caso de test, así
  // el fallo nombra la ruta rota en vez de un "alguna ruta está mal".
  describe.each(notFoundRoutes.map((r) => [r.route, r] as const))(
    "%s",
    (_route, entry) => {
      it("no tiene ningún loading.tsx por encima → puede devolver 404 real", () => {
        expect(boundariesOver(entry.dir)).toEqual([]);
      });
    },
  );

  it("no vuelve a existir src/app/loading.tsx (envolvía la app entera)", () => {
    const root = loadingBoundaries.find((b) => b.dir === APP_DIR);
    expect(root).toBeUndefined();
  });

  it("cubre las rutas de detalle reportadas el 2026-07-27", () => {
    const reported = ["/feed/[id]", "/eventos/[id]", "/propiedades/[id]", "/marketplace/[id]"];
    for (const route of reported) {
      const entry = notFoundRoutes.find((r) => r.route === route);
      expect(entry, `${route} debería llamar notFound()`).toBeDefined();
      expect(boundariesOver(entry!.dir), `${route} tiene un loading.tsx encima`).toEqual([]);
    }
  });

  it("los skeletons de lista que quedan sólo cubren rutas sin notFound()", () => {
    const offending = loadingBoundaries
      .filter((b) => notFoundRoutes.some((r) => covers(b.dir, r.dir)))
      .map((b) => path.relative(APP_DIR, b.file).split(path.sep).join("/"));
    expect(offending).toEqual([]);
  });
});
