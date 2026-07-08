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
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./src/test/server-only.stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/worktrees/**"],
  },
});
