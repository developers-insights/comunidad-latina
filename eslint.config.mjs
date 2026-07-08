import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Service worker generado por @serwist/next en el build (no es código fuente).
    "public/sw.js",
    // Los git worktrees viven anidados en `.claude/worktrees/`, así que desde la
    // raíz eslint entra ahí: lintea el `.next/` de OTRA rama (miles de errores en
    // bundles minificados) y su código fuente, que puede no estar al día. Cada
    // worktree lintea desde su propia raíz. Mismo motivo que el `exclude` de
    // vitest.config.ts. `.next/**` a secas no alcanza: solo matchea en la raíz.
    "**/.claude/worktrees/**",
    "**/.next/**",
  ]),
]);

export default eslintConfig;
