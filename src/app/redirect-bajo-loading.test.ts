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
 * Los helpers que redirigen cuentan igual que un `redirect()` escrito en la
 * página: `requireStaff("domain_admin")` necesita un layout con `requireStaff` de
 * ese rol o más, y los hilos de mensajes, uno con sesión. Si aparece otro módulo
 * que redirige, el último test falla hasta que se decida acá cómo se cubre.
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
const HILO_QUE_MANDA_A_ENTRAR = /<Hilo(?:Directo|DeGrupo)\b/;
const REDIRECT = /\b(?:redirect|permanentRedirect)\(/;
const SRC_DIR = path.dirname(APP_DIR);

const RANGO_STAFF: Record<string, number> = { moderator: 1, domain_admin: 2, global_admin: 3 };

/** Módulos que redirigen por su cuenta, sin contar páginas, layouts ni rutas. */
const HELPERS_CONOCIDOS = [
  "app/admin/guard.ts",
  "components/messaging/hilo-de-grupo.tsx",
  "components/messaging/hilo-directo.tsx",
  "lib/auth/exigir-sesion.ts",
];

function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** El rol más alto que pide `requireStaff`; 0 si no lo llama. Sin argumento es moderator. */
function rangoDeStaff(codigo: string): number {
  const llamadas = [...codigo.matchAll(/requireStaff\(\s*(?:"(\w+)"\s*)?\)/g)];
  return Math.max(0, ...llamadas.map(([, rol]) => RANGO_STAFF[rol ?? "moderator"]));
}

function modulos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return modulos(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

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
  const aEntrar = REDIRECT_A_ENTRAR.test(pagina) || HILO_QUE_MANDA_A_ENTRAR.test(pagina);
  const aBienvenida = REDIRECT_A_BIENVENIDA.test(pagina);
  const staff = rangoDeStaff(pagina);
  if (!aEntrar && !aBienvenida && staff === 0) return false;

  const niveles = cadena(dir);
  if (!niveles.some((nivel) => existsSync(path.join(nivel, "loading.tsx")))) return false;

  const layouts = niveles
    .map((nivel) => path.join(nivel, "layout.tsx"))
    .filter((layout) => existsSync(layout))
    .map((layout) => sinComentarios(readFileSync(layout, "utf8")));
  const conPerfil = layouts.some((layout) => layout.includes("exigirPerfil("));
  const conSesion = conPerfil || layouts.some((layout) => layout.includes("exigirSesion("));
  const staffCubierto = Math.max(0, ...layouts.map(rangoDeStaff));
  return (aEntrar && !conSesion) || (aBienvenida && !conPerfil) || staff > staffCubierto;
}

describe("redirect por sesión, perfil o rol debajo de un loading.tsx", () => {
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

  it("lee el rol de `requireStaff`, y el default es moderator", () => {
    expect(rangoDeStaff("await requireStaff()")).toBe(1);
    expect(rangoDeStaff('await requireStaff("domain_admin")')).toBe(2);
    expect(rangoDeStaff('requireStaff("global_admin"), searchParams')).toBe(3);
    expect(rangoDeStaff("getStaffContext()")).toBe(0);
  });

  it("todo helper que redirige está contemplado acá", () => {
    const helpers = modulos(SRC_DIR)
      .filter((archivo) => {
        const nombre = path.basename(archivo);
        const ruta = /^(page|layout|route|middleware)\.tsx?$/.test(nombre);
        const accion = /actions\.ts$/.test(nombre) || nombre.includes(".test.");
        return !ruta && !accion && REDIRECT.test(sinComentarios(readFileSync(archivo, "utf8")));
      })
      .map((archivo) => path.relative(SRC_DIR, archivo).split(path.sep).join("/"))
      .sort();
    expect(helpers).toEqual(HELPERS_CONOCIDOS);
  });
});
