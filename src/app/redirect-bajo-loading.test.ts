import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * INVARIANTE: una página que manda a /entrar y cuelga de un `loading.tsx`
 * necesita un `layout.tsx` con `exigirSesion()` en su segmento o más arriba. Una
 * que manda a /bienvenida, uno con `exigirPerfil()`, que además incluye la sesión.
 *
 * Sin eso el redirect viaja dentro del stream, y en Next 16.2.12 el visitante
 * sin sesión ve "This page couldn't load" (error #310 en el `Router`) antes de
 * llegar al login. El porqué completo está en `lib/auth/exigir-sesion.ts`.
 *
 * `DEUDA` son las rutas que tienen hoy el problema y quedaron sin arreglar. Hoy
 * está vacía: no se agrega una ruta nueva acá, se le pone `exigirSesion()` al
 * layout. Si alguna vez vuelve a usarse, el test falla cuando la lista queda
 * vieja, así no sobrevive una excepción que ya no hace falta.
 */
const DEUDA: string[] = [];

const APP_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)));
const REDIRECT_A_ENTRAR = /redirect\(\s*[`"]\/entrar/;
const REDIRECT_A_BIENVENIDA = /redirect\(\s*[`"]\/bienvenida/;

function paginas(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return paginas(full);
    return entry.name === "page.tsx" ? [dir] : [];
  });
}

/** Del segmento de la página hasta `src/app`, sin incluirlo. */
function cadena(dir: string): string[] {
  const niveles: string[] = [];
  for (let actual = dir; actual !== APP_DIR; actual = path.dirname(actual)) {
    niveles.push(actual);
  }
  return niveles;
}

function expuesta(dir: string): boolean {
  const pagina = readFileSync(path.join(dir, "page.tsx"), "utf8");
  const aEntrar = REDIRECT_A_ENTRAR.test(pagina);
  const aBienvenida = REDIRECT_A_BIENVENIDA.test(pagina);
  if (!aEntrar && !aBienvenida) return false;

  const niveles = cadena(dir);
  if (!niveles.some((nivel) => existsSync(path.join(nivel, "loading.tsx")))) return false;

  const layouts = niveles
    .map((nivel) => path.join(nivel, "layout.tsx"))
    .filter((layout) => existsSync(layout))
    .map((layout) => readFileSync(layout, "utf8"));
  const conPerfil = layouts.some((layout) => layout.includes("exigirPerfil("));
  const conSesion = conPerfil || layouts.some((layout) => layout.includes("exigirSesion("));
  return (aEntrar && !conSesion) || (aBienvenida && !conPerfil);
}

describe("redirect a /entrar o /bienvenida debajo de un loading.tsx", () => {
  const rutas = paginas(APP_DIR)
    .filter(expuesta)
    .map((dir) => path.relative(APP_DIR, dir))
    .sort();

  it("ninguna ruta nueva redirige desde adentro del stream", () => {
    expect(rutas.filter((ruta) => !DEUDA.includes(ruta))).toEqual([]);
  });

  it("la lista de deuda no guarda rutas ya arregladas", () => {
    expect(DEUDA.filter((ruta) => !rutas.includes(ruta))).toEqual([]);
  });
});
