import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config mínima de Vitest.
 *
 * - `@/*` espeja el path alias de tsconfig.json.
 * - `exclude`: los git worktrees viven anidados en `.claude/worktrees/` y el
 *   escaneo por defecto levantaría los tests de OTRA rama, con su propio código
 *   y sus propios stubs. Cada worktree corre sus tests desde su raíz.
 * - Los tests de componentes piden `// @vitest-environment jsdom` en su cabecera;
 *   los de lógica pura se quedan en el entorno node, que arranca más rápido.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/worktrees/**"],
  },
});
