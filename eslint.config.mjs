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
  {
    rules: {
      /**
       * El prefijo `_` significa "esto no se usa A PROPÓSITO", y este repo ya lo
       * escribe así en varios lados: `_prev`/`_formData` en una server action que
       * cumple la firma de `useActionState` sin necesitar los dos argumentos,
       * `_id`/`_attrs` en el doble de un test que sólo mira que la llamada
       * ocurra, `_label` en un componente que descarta una prop del contrato.
       *
       * Sin esta regla la convención es decorativa: quien la escribe pide que no
       * le avisen y el linter avisa igual. Eso enseña a ignorar warnings, que es
       * exactamente cómo 147 de ruido tuvieron escondido meses al que sí
       * importaba.
       *
       * `caughtErrors: "all"` con la misma excepción: un `catch (e)` donde `e`
       * no se mira es el defecto de los "catch mudos" que este repo persigue —
       * queremos que avise, salvo que se escriba `catch (_e)` para decir que el
       * error de verdad no aporta nada.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
