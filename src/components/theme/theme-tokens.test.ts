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

const root = declarations(block(/^:root \{([\s\S]*?)^\}/m));
const darkClass = declarations(block(/^\.dark \{([\s\S]*?)^\}/m));
const media = declarations(
  block(
    /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\.light\):not\(\.dark\) \{([\s\S]*?)^ {2}\}/m,
  ),
);

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

describe("contraste de los tokens que no derivan del tenant", () => {
  /** Los `-bg`, superficies y tintas de estado son fijos: se pueden medir acá. */
  const LIGHT = { surface: "#ffffff", canvas: "#fcfcfb", subtle: "#f7f6f3", hover: "#efede8" };
  const DARK = { surface: "#24211b", canvas: "#17150f", raised: "#2b2820" };
  const AA = 4.5;

  it("el fill de success/warning NO es AA como texto: por eso existe `-ink`", () => {
    expect(wcagContrast("#1a7f5a", "#e8f5ee")).toBeLessThan(AA); // 4.43:1
    expect(wcagContrast("#b7791f", "#fbf2e3")).toBeLessThan(AA); // 3.28:1
  });

  it.each([
    ["success-ink", "#177252", "#e8f5ee"],
    ["warning-ink", "#8f5c10", "#fbf2e3"],
  ])("light: text-%s es AA sobre su -bg y sobre las superficies claras", (_n, ink, bg) => {
    expect(wcagContrast(ink, bg)).toBeGreaterThanOrEqual(AA);
    for (const surface of Object.values(LIGHT)) {
      expect(wcagContrast(ink, surface)).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each([
    ["success", "#46b184", "#12271d"],
    ["warning", "#d9a044", "#2a2010"],
  ])("dark: el fill de %s ya es AA como texto (el -ink lo aliasea)", (_n, ink, bg) => {
    expect(wcagContrast(ink, bg)).toBeGreaterThanOrEqual(AA);
    for (const surface of Object.values(DARK)) {
      expect(wcagContrast(ink, surface)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("danger e info sí pasan como texto sobre su -bg: no necesitan `-ink`", () => {
    expect(wcagContrast("#c23b3b", "#fbeaea")).toBeGreaterThanOrEqual(AA);
    expect(wcagContrast("#2b6cb0", "#e9f1fa")).toBeGreaterThanOrEqual(AA);
    expect(CSS).not.toContain("--color-danger-ink");
    expect(CSS).not.toContain("--color-info-ink");
  });

  it("el placeholder es texto (1.4.3) y llega a AA sobre el fondo de los inputs", () => {
    // input.tsx/textarea/select se pintan sobre bg-surface en los dos temas.
    expect(root.get("--cl-light-placeholder")).toBe("var(--color-neutral-500)");
    expect(root.get("--cl-dark-placeholder")).toBe("var(--color-neutral-400)");
    expect(wcagContrast("#7a7364", LIGHT.surface)).toBeGreaterThanOrEqual(AA); // 4.70:1
    expect(wcagContrast("#a39c8c", DARK.surface)).toBeGreaterThanOrEqual(AA); // 5.88:1
    expect(wcagContrast("#a39c8c", DARK.raised)).toBeGreaterThanOrEqual(AA); // 5.39:1 (diálogos)
  });

  it("text-foreground-muted NO es AA sobre surface-subtle ni surface-hover", () => {
    // Regla documentada en globals.css: ahí va text-foreground-secondary.
    expect(wcagContrast("#7a7364", LIGHT.subtle)).toBeLessThan(AA); // 4.35:1
    expect(wcagContrast("#7a7364", LIGHT.hover)).toBeLessThan(AA); // 4.02:1
    expect(wcagContrast("#5c564a", LIGHT.subtle)).toBeGreaterThanOrEqual(AA); // secondary: 6.74:1
    expect(wcagContrast("#5c564a", LIGHT.hover)).toBeGreaterThanOrEqual(AA); // 6.22:1
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
