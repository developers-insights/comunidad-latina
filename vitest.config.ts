import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config mínima de Vitest.
 *
 * - `@/*` espeja el path alias de tsconfig.json.
 * - `server-only` se apunta a un stub: fuera de un render RSC ese paquete lanza
 *   a propósito ("cannot be imported from a Client Component"). Neutralizarlo
 *   solo en tests deja que se testeen los módulos que lo importan (`lib/tenant/guard.ts`,
 *   igual que `app/admin/guard.ts`) sin aflojar la protección en build ni en runtime.
 * - `exclude`: los git worktrees viven anidados en `.claude/worktrees/` y el
 *   escaneo por defecto levantaría los tests de OTRA rama, con su propio código
 *   y sus propios stubs. Cada worktree corre sus tests desde su raíz.
 * - Los tests de componentes piden `// @vitest-environment jsdom` en su cabecera;
 *   los de lógica pura se quedan en el entorno node, que arranca más rápido.
 * - `execArgv`: ver WEBSTORAGE_ARGV abajo.
 */

/**
 * Devolverle a jsdom su `localStorage` cuando el Node que corre los tests se lo
 * roba.
 *
 * Desde Node 22.4 existe un Web Storage propio del runtime. En Node 26 se
 * instala un accessor `localStorage` sobre `globalThis` **siempre**, y su getter
 * devuelve `undefined` salvo que se arranque con `--localstorage-file`. Como en
 * el entorno jsdom de Vitest `window === globalThis`, ese accessor tapa al
 * `localStorage` real de jsdom: `window.localStorage` queda `undefined` y todo
 * test que lo toque muere en su `beforeEach`. (`sessionStorage` no se ve
 * afectado: el stub del runtime es sólo para `localStorage`.)
 *
 * `--no-experimental-webstorage` hace que Node no lo instale y jsdom vuelve a
 * ganar, con su `Storage` de verdad — lo que importa porque hay tests que espían
 * `Storage.prototype.setItem`, y un reemplazo hecho a mano no comparte ese
 * prototipo.
 *
 * El flag se pasa sólo si el Node actual lo conoce: este repo no fija versión, y
 * un flag desconocido no degrada, impide arrancar el proceso. Los Node donde el
 * problema no existe son exactamente los que no tienen el flag, así que la
 * condición cubre el caso entero.
 */
const WEBSTORAGE_ARGV = process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
  ? ["--no-experimental-webstorage"]
  : [];

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./src/test/server-only.stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/worktrees/**"],
    execArgv: WEBSTORAGE_ARGV,
  },
});
