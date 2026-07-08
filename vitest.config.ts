import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config mínima de Vitest.
 *
 * - `@/*` espeja el path alias de tsconfig.json.
 * - `server-only` se apunta a un stub: fuera de un render RSC ese paquete lanza
 *   a propósito ("cannot be imported from a Client Component"). Neutralizarlo
 *   solo en tests deja que se testeen los módulos que lo importan (guard.ts,
 *   igual que admin/guard.ts) sin aflojar la protección en build ni en runtime.
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./src/test/server-only.stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
