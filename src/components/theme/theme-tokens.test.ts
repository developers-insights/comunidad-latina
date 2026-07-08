import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wcagContrast } from "culori";
import { describe, expect, it } from "vitest";
import { brandThemeToStyle } from "../../lib/tenant/brand-pipeline";
import { DARK_THEME_COLOR, MEDIA_QUERY, THEME_STORAGE_KEY } from "./constants";
import { themeScriptSource } from "./theme-script-source";

/**
 * globals.css define los VALORES de cada token una sola vez (`--cl-light-*` /
 * `--cl-dark-*`) pero repite la lista de ALIAS en `.dark` y en el bloque
 * `@media (prefers-color-scheme: dark)`, porque una condición @media no puede
 * formar parte de un selector. Esa repetición es el único punto donde los dos
 * caminos a dark pueden divergir en silencio: acá se verifica que no lo hagan.
 *
 * También ancla los hex que el brand pipeline y el <ThemeScript /> asumen.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GLOBALS = readFileSync(resolve(HERE, "../../app/globals.css"), "utf8");
/** Los comentarios traen ejemplos como `dark:hover:bg-…`: fuera antes de parsear. */
const CSS = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, "");

/** Extrae `--x: y;` de un bloque. Los bloques de tokens no tienen anidamiento. */
function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const chunk of block.split(";")) {
    const match = /^\s*(--[a-z0-9-]+|color-scheme)\s*:\s*([\s\S]+)$/i.exec(chunk);
    if (match) out.set(match[1], match[2].replace(/\s+/g, " ").trim());
  }
  return out;
}

function block(pattern: RegExp): string {
  const match = pattern.exec(CSS);
  expect(match, `no encontré el bloque ${pattern}`).not.toBeNull();
  return match![1];
}

const theme = declarations(block(/^@theme \{([\s\S]*?)^\}/m));
const themeInline = declarations(block(/^@theme inline \{([\s\S]*?)^\}/m));
const root = declarations(block(/^:root \{([\s\S]*?)^\}/m));
const darkClass = declarations(block(/^\.dark \{([\s\S]*?)^\}/m));
const media = declarations(
  block(
    /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\.light\):not\(\.dark\) \{([\s\S]*?)^ {2}\}/m,
  ),
);
const printReset = declarations(
  block(
    /@media print \{\s*:root,\s*:root\.light,\s*:root\.dark,\s*:root:not\(\.light\):not\(\.dark\) \{([\s\S]*?)^ {2}\}/m,
  ),
);

/**
 * Resuelve una cadena de `var(--a, var(--b))` hasta el literal, con el mismo
 * algoritmo del navegador: gana el scope, y si el token no existe se cae al
 * fallback. Sin inline style del tenant, la marca resuelve a los escalones
 * default de `@theme` — que es justo el peor caso que queremos anclar.
 */
function splitTopLevelComma(value: string): [string, string | null] {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (value[i] === "," && depth === 0) return [value.slice(0, i), value.slice(i + 1)];
  }
  return [value, null];
}

function resolveVar(value: string, scope: Map<string, string>, depth = 0): string {
  const trimmed = value.trim();
  if (depth > 30) throw new Error(`ciclo de var() resolviendo ${value}`);
  if (!trimmed.startsWith("var(")) return trimmed;
  const inner = trimmed.slice(4, trimmed.lastIndexOf(")"));
  const [name, fallback] = splitTopLevelComma(inner);
  const key = name.trim();
  if (scope.has(key)) return resolveVar(scope.get(key)!, scope, depth + 1);
  if (fallback !== null) return resolveVar(fallback, scope, depth + 1);
  throw new Error(`${key} no está definido y no tiene fallback`);
}

const merge = (...maps: Map<string, string>[]) => new Map(maps.flatMap((m) => [...m]));
const LIGHT_SCOPE = merge(theme, themeInline, root);
const DARK_SCOPE = merge(theme, themeInline, root, darkClass);
const PRINT_SCOPE = merge(theme, themeInline, root, darkClass, printReset);
const color = (token: string, scope: Map<string, string>) => resolveVar(`var(${token})`, scope);

/** Alias = token semántico activo. Excluye las paletas `--cl-light-*` / `--cl-dark-*`. */
function aliasNames(decls: Map<string, string>): string[] {
  return [...decls.keys()].filter(
    (name) => name.startsWith("--cl-") && !/^--cl-(light|dark)-/.test(name),
  );
}

describe("globals.css — paridad de los dos caminos a dark", () => {
  it(".dark y el @media declaran EXACTAMENTE lo mismo", () => {
    expect(Object.fromEntries(media)).toEqual(Object.fromEntries(darkClass));
  });

  it("ambos caminos declaran color-scheme: dark", () => {
    expect(root.get("color-scheme")).toBe("light");
    expect(darkClass.get("color-scheme")).toBe("dark");
    expect(media.get("color-scheme")).toBe("dark");
  });

  it("--cl-theme-dark vale 0 en light y 1 en dark (lo consume el ThemeToggle)", () => {
    expect(root.get("--cl-theme-dark")).toBe("0");
    expect(darkClass.get("--cl-theme-dark")).toBe("1");
    expect(media.get("--cl-theme-dark")).toBe("1");
    expect(CSS).toContain("@property --cl-theme-dark");
  });

  it("el @custom-variant dark cubre los mismos dos casos que los tokens", () => {
    expect(CSS).toMatch(/@custom-variant dark \{/);
    expect(CSS).toContain("&:where(.dark, .dark *)");
    expect(CSS).toContain(
      "&:where(:root:not(.light):not(.dark), :root:not(.light):not(.dark) *)",
    );
  });
});

describe("globals.css — cada token tiene su par light/dark", () => {
  const lightPalette = [...root.keys()].filter((name) => name.startsWith("--cl-light-"));

  it("hay paleta light y no está vacía", () => {
    expect(lightPalette.length).toBeGreaterThan(20);
  });

  it.each(lightPalette)("%s tiene su contraparte dark", (name) => {
    expect(root.has(name.replace("--cl-light-", "--cl-dark-"))).toBe(true);
  });

  it("todos los alias del :root se reapuntan en dark, y sin sobrantes", () => {
    expect(aliasNames(darkClass).sort()).toEqual(aliasNames(root).sort());
  });

  it("los alias son pura indirección: nunca un valor literal", () => {
    for (const name of aliasNames(root)) {
      if (name === "--cl-theme-dark") continue;
      expect(root.get(name), `${name} en :root`).toBe(
        `var(${name.replace("--cl-", "--cl-light-")})`,
      );
      expect(darkClass.get(name), `${name} en .dark`).toBe(
        `var(${name.replace("--cl-", "--cl-dark-")})`,
      );
    }
  });
});

describe("globals.css — el contrato con el resto del enjambre", () => {
  it("no queda ninguna utility `dark:` en el CSS", () => {
    expect(CSS).not.toMatch(/\bdark:[a-z[(]/);
  });

  it("--color-brand se resuelve desde el tema activo, sin capa", () => {
    // Tiene que existir como custom property real: hay `text-[var(--color-brand)]`.
    expect(root.get("--color-brand")).toBe("var(--cl-brand)");
    expect(root.get("--color-brand-foreground")).toBe("var(--cl-brand-foreground)");
  });

  it("expone los tokens semánticos que reemplazan a las `dark:` viejas", () => {
    for (const token of [
      "--color-surface-hover",
      "--color-surface-inverse",
      "--color-on-surface-inverse",
      "--color-border-strong",
      "--color-brand-ink",
      "--color-brand-tint",
      "--color-brand-subtle",
      "--color-brand-hover",
      "--color-on-success",
      "--color-on-warning",
      "--color-on-danger",
      "--color-on-info",
      "--color-on-media",
      "--color-media-scrim",
      "--color-media-shade",
      "--color-media-backdrop",
      "--color-focus-ring",
      "--color-success-ink",
      "--color-warning-ink",
      "--color-danger-ink",
      "--color-info-ink",
      "--color-gold-ink",
      "--color-brand-strong",
    ]) {
      expect(CSS, `falta ${token}`).toContain(`${token}:`);
    }
  });

  it("el anillo de foco sale del token de tema, no de brand-200", () => {
    // brand-200 es un escalón casi blanco POR CONSTRUCCIÓN (LIGHTNESS[200]=0.885,
    // para cualquier tenant): 1.33–1.44:1 contra el canvas claro. §2.8: "nunca un
    // borde que desaparece en un tema".
    expect(CSS).toContain("--shadow-focus-ring: 0 0 0 3px var(--cl-focus-ring);");
    expect(root.get("--cl-light-focus-ring")).toBe("var(--cl-light-brand-ink)");
    expect(root.get("--cl-dark-focus-ring")).toBe("var(--color-brand-200)");
  });
});

/**
 * LA MATRIZ. Se resuelve desde el CSS real, no desde hex copiados a mano: si
 * alguien mueve un token y rompe AA, explota acá y no en producción.
 *
 * El contrato de las tres familias (documentado arriba de globals.css):
 *   `x`      RELLENO      → objeto gráfico, ≥3:1 (WCAG 1.4.11)
 *   `x-ink`  TEXTO        → ≥4.5:1 contra TODA superficie del tema y su `-bg`
 *   `on-x`   SOBRE EL FILL → ≥4.5:1 contra `x`
 */
describe("contraste de los tokens que no derivan del tenant", () => {
  const AA = 4.5;
  const UI = 3;
  /** Cada superficie sobre la que puede caer texto. `surface-hover` incluido. */
  const SURFACES = [
    "--color-canvas",
    "--color-surface",
    "--color-surface-subtle",
    "--color-surface-raised",
    "--color-surface-hover",
  ];
  const THEMES: [string, Map<string, string>][] = [
    ["light", LIGHT_SCOPE],
    ["dark", DARK_SCOPE],
  ];

  /** El ratio de `token` contra la superficie PEOR de su tema. */
  function worstOnSurfaces(token: string, scope: Map<string, string>): number {
    return Math.min(...SURFACES.map((s) => wcagContrast(color(token, scope), color(s, scope))));
  }

  it("el fill de success/warning/gold NO es AA como texto: por eso existe `-ink`", () => {
    // Es la razón de ser de toda la familia. Si esto dejara de ser cierto,
    // el desdoble sobra — y hay que borrarlo, no dejarlo por inercia.
    expect(wcagContrast("#1a7f5a", "#e8f5ee")).toBeLessThan(AA); // success/success-bg 4.43:1
    expect(wcagContrast("#b7791f", "#fbf2e3")).toBeLessThan(AA); // warning/warning-bg 3.28:1
    expect(wcagContrast("#b7791f", "#ffffff")).toBeLessThan(AA); // gold/surface       3.64:1
  });

  describe.each(THEMES)("tema %s", (_theme, scope) => {
    it.each([
      "--color-foreground",
      "--color-foreground-secondary",
      "--color-foreground-muted",
      "--color-placeholder",
    ])("%s es AA sobre TODAS las superficies (1.4.3)", (token) => {
      expect(worstOnSurfaces(token, scope)).toBeGreaterThanOrEqual(AA);
    });

    it.each(["success", "warning", "danger", "info"])(
      "%s-ink es AA sobre su -bg y sobre TODAS las superficies",
      (state) => {
        const ink = color(`--color-${state}-ink`, scope);
        expect(wcagContrast(ink, color(`--color-${state}-bg`, scope))).toBeGreaterThanOrEqual(AA);
        expect(worstOnSurfaces(`--color-${state}-ink`, scope)).toBeGreaterThanOrEqual(AA);
      },
    );

    it("gold-ink es AA sobre TODAS las superficies (el dorado no tiene -bg)", () => {
      expect(worstOnSurfaces("--color-gold-ink", scope)).toBeGreaterThanOrEqual(AA);
    });

    it.each(["success", "warning", "danger", "info"])(
      "on-%s es AA sobre el relleno sólido de su estado",
      (state) => {
        const on = color(`--color-on-${state}`, scope);
        expect(wcagContrast(on, color(`--color-${state}`, scope))).toBeGreaterThanOrEqual(AA);
      },
    );

    it.each(["success", "warning", "danger", "info", "gold"])(
      "el relleno de %s llega al 3:1 de objeto gráfico sobre canvas y surface",
      (state) => {
        for (const surface of ["--color-canvas", "--color-surface"]) {
          const ratio = wcagContrast(color(`--color-${state}`, scope), color(surface, scope));
          expect(ratio).toBeGreaterThanOrEqual(UI);
        }
      },
    );

    it("brand-strong identifica un estado: ≥3:1 sobre toda superficie (1.4.11)", () => {
      // Con los fallbacks de @theme. El barrido por tenant vive en el pipeline.
      expect(worstOnSurfaces("--color-brand-strong", scope)).toBeGreaterThanOrEqual(UI);
    });

    it("brand-subtle es DECORATIVO: no llega a 3:1 y por eso nunca señala solo", () => {
      const ratio = wcagContrast(color("--color-brand-subtle", scope), color("--color-surface", scope));
      expect(ratio).toBeLessThan(UI);
    });

    it("el anillo de foco se ve contra canvas y surface", () => {
      for (const surface of ["--color-canvas", "--color-surface"]) {
        expect(
          wcagContrast(color("--color-focus-ring", scope), color(surface, scope)),
        ).toBeGreaterThanOrEqual(UI);
      }
    });
  });

  it("el placeholder ES el tono muted, por referencia y no por copia", () => {
    expect(root.get("--cl-light-placeholder")).toBe("var(--cl-light-foreground-muted)");
    expect(root.get("--cl-dark-placeholder")).toBe("var(--cl-dark-foreground-muted)");
  });

  it("danger/info en light aliasean su fill; en dark sólo danger necesita tono propio", () => {
    // Un `-ink` que es alias no es un token de más: el call site nunca tiene que
    // averiguar cuál de los cuatro estados pasa AA y cuál no. Siempre `-ink`.
    expect(root.get("--cl-light-danger-ink")).toBe("var(--cl-light-danger)");
    expect(root.get("--cl-light-info-ink")).toBe("var(--cl-light-info)");
    expect(root.get("--cl-dark-info-ink")).toBe("var(--cl-dark-info)");
    expect(root.get("--cl-dark-gold-ink")).toBe("var(--cl-dark-gold)");
    // #e26a6a daba 4.19:1 sobre bg-surface-hover: una fila de menú con "Eliminar".
    expect(wcagContrast("#e26a6a", "#322e25")).toBeLessThan(AA);
    expect(root.get("--cl-dark-danger-ink")).toBe("#ec7372");
  });
});

describe("@media print — la guía impresa tiene que leerse (12a)", () => {
  it("los tokens vuelven a sus valores light aunque el usuario esté en dark", () => {
    for (const token of themeInline.keys()) {
      expect(color(token, PRINT_SCOPE), `${token} no volvió a light al imprimir`).toBe(
        color(token, LIGHT_SCOPE),
      );
    }
  });

  it("el bloque print revierte TODOS los alias que pisa .dark", () => {
    const sinRevertir = [...darkClass.keys()].filter((name) => !printReset.has(name));
    expect(sinRevertir).toEqual([]);
  });

  it("el texto del body es tinta oscura sobre papel blanco", () => {
    // En dark, `body { color: #f7f6f3 }` daba 1.08:1 contra el papel: hoja en blanco.
    expect(wcagContrast(color("--color-foreground", DARK_SCOPE), "#ffffff")).toBeLessThan(1.5);
    expect(
      wcagContrast(color("--color-foreground", PRINT_SCOPE), "#ffffff"),
    ).toBeGreaterThanOrEqual(7);
  });

  it("esconde el chrome sin llevarse puesto el <header> del artículo", () => {
    // `header:not(main header)` — el <header> del <article> de la guía vive dentro
    // de <main> y trae el título; el sticky del layout no.
    expect(CSS).toMatch(/header:not\(main header\)/);
  });
});

describe("@media (forced-colors: active) — el foco real es box-shadow (12b)", () => {
  it("restituye un outline de verdad: forced-colors borra el box-shadow", () => {
    expect(CSS).toMatch(/@media \(forced-colors: active\)/);
    expect(CSS).toMatch(/outline: 2px solid Highlight/);
  });

  it("los estados que sólo se comunican por fondo se mapean a Highlight", () => {
    // chips seleccionados, tabs activas, item actual del bottom-nav.
    expect(CSS).toContain('[aria-pressed="true"]');
    expect(CSS).toContain('[aria-selected="true"]');
    expect(CSS).toContain('[aria-current="page"]');
    expect(CSS).toContain("forced-color-adjust: none");
  });

  it("el comentario `forced-colors` del focus ring ya no simula una cobertura falsa", () => {
    // Sobre el CSS con comentarios: `CSS` los tiene borrados y el test sería vacuo.
    expect(GLOBALS).not.toMatch(/outline: 2px solid transparent; \/\* forced-colors \*\//);
  });
});

describe("anclas compartidas entre CSS, script y pipeline", () => {
  it("DARK_THEME_COLOR es el canvas oscuro real (--color-neutral-900)", () => {
    expect(DARK_THEME_COLOR.toLowerCase()).toBe("#17150f");
    expect(CSS).toContain("--color-neutral-900: #17150f;");
    expect(root.get("--cl-dark-canvas")).toBe("var(--color-neutral-900)");
  });

  it("el brand pipeline valida contra la superficie más clara del tema dark", () => {
    expect(root.get("--cl-dark-surface-raised")).toBe("#2b2820");
  });

  it("el script pre-paint estampa las clases que espera el CSS", () => {
    const source = themeScriptSource("#1A5EDB");
    expect(source).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
    expect(source).toContain(`window.matchMedia("${MEDIA_QUERY}")`);
    expect(source).toContain('classList.remove("light","dark")');
    expect(source).toContain('classList.add(d?"dark":"light")');
    // El @media del CSS usa la misma media query que el script.
    expect(CSS).toContain(`@media ${MEDIA_QUERY}`);
  });

  it("el script pre-paint deja UNA meta theme-color, sin `media`, del tema resuelto", () => {
    const source = themeScriptSource("#1A5EDB");
    // Las metas de generateViewport() siguen al SO; ésta sigue al toggle.
    expect(source).toContain(`meta[name="theme-color"]`);
    expect(source).toContain("m[i].remove()");
    expect(source).toContain(`d?"${DARK_THEME_COLOR}":"#1A5EDB"`);
    expect(source).not.toContain("media=");
  });

  it("el hex del tenant no puede escaparse del <script> inline", () => {
    // `JSON.stringify` escapa comillas pero NO `</script>`: sin allowlist, el
    // admin de un tenant inyectaba markup en todas las páginas de su dominio.
    for (const evil of [
      '#fff"</script><script>alert(1)</script>',
      "</script><img src=x onerror=alert(1)>",
      "javascript:alert(1)",
      "red",
      "#12345",
    ]) {
      const source = themeScriptSource(evil);
      expect(source).not.toContain("</script>");
      expect(source).not.toContain("alert(1)");
      expect(source).toContain('"#1a5edb"'); // cae al azul default del pipeline
    }
    // Un hex legítimo sí pasa, en cualquier capitalización.
    expect(themeScriptSource("#C0492A")).toContain('"#C0492A"');
  });

  it("el pipeline no pisa --color-brand (lo congelaría en light)", () => {
    const style = brandThemeToStyle("#1A5EDB");
    expect(style["--color-brand"]).toBeUndefined();
    expect(style["--brand-light"]).toBeDefined();
    expect(style["--brand-dark"]).toBeDefined();
  });
});
