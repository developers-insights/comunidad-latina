import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { wcagContrast } from "culori";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * EL CONTRATO DE LA HOJA IMPRESA (defecto [12]).
 *
 * La página que la gente imprime es /guias/[slug]: trámites, ITIN, papeles que se
 * llevan a una oficina. El navegador NO imprime `background-color`, pero SÍ
 * imprime `color`. De ahí salen los dos modos de falla que este archivo ancla:
 *
 *  1. TINTA CLARA SOBRE PAPEL BLANCO. Todo el tema se fuerza a light dentro de
 *     `@media print` (eso ya estaba y funciona). Lo que faltaba es la familia
 *     `on-*`: `text-brand-foreground`, `text-on-success`, `text-on-danger`,
 *     `text-on-info`, `text-on-surface-inverse` y `text-on-media` son claras POR
 *     DEFINICIÓN — existen para leerse encima de un relleno saturado. Sin ese
 *     relleno quedan en 1.00:1. El tema no las arregla porque no dependen del tema.
 *
 *  2. CHROME ESCONDIDO CON UN ROL DE ARIA. El bloque print tenía
 *     `[role="status"], [aria-live] { display: none }` con un comentario que decía
 *     "cubre el banner offline y el de tenant mismatch". No: matchea 33 nodos de
 *     `src/`, y varios son el CONTENIDO — la burbuja de respuesta del asistente, el
 *     veredicto del verificador de estafas, el comprobante de "impulsado hasta". Un
 *     `aria-live` no dice "decoración": dice "esto apareció recién". Como
 *     `@media print` no depende del tema, eso rompía también al usuario en light.
 *
 * Los dos hooks explícitos, en globals.css, sin capa (le ganan a `@layer utilities`
 * sin `!important`):
 *   · `.cl-print-hide` → display: none. Chrome que en papel no significa nada.
 *   · `.cl-print-fill` → print-color-adjust: exact. Fuerza el relleno a imprimirse
 *     donde la tinta `on-*` lo necesita para existir.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const ROOT = resolve(SRC, "..");
const GLOBALS = readFileSync(resolve(SRC, "app/globals.css"), "utf8");
const CSS = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, "");

const PAPEL = "#ffffff";
/** AA de texto. Un `on-*` que caiga acá abajo contra el papel NO puede quedar suelto. */
const AA = 4.5;

/* ══════════════════════════════════════════════════════════════════════════
 * Resolución de tokens desde el CSS real (mismo algoritmo que theme-tokens.test)
 * ═════════════════════════════════════════════════════════════════════════ */

function declarations(bloque: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const chunk of bloque.split(";")) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+)$/i.exec(chunk);
    if (m) out.set(m[1], m[2].replace(/\s+/g, " ").trim());
  }
  return out;
}

function block(pattern: RegExp): string {
  const m = pattern.exec(CSS);
  expect(m, `no encontré el bloque ${pattern}`).not.toBeNull();
  return m![1];
}

const theme = declarations(block(/^@theme \{([\s\S]*?)^\}/m));
const themeInline = declarations(block(/^@theme inline \{([\s\S]*?)^\}/m));
const root = declarations(block(/^:root \{([\s\S]*?)^\}/m));
const darkClass = declarations(block(/^\.dark \{([\s\S]*?)^\}/m));
const printReset = declarations(
  block(
    /@media print \{\s*:root,\s*:root\.light,\s*:root\.dark,\s*:root:not\(\.light\):not\(\.dark\) \{([\s\S]*?)^ {2}\}/m,
  ),
);

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
/** El peor caso: el usuario estaba en dark y mandó a imprimir. */
const PRINT_SCOPE = merge(theme, themeInline, root, darkClass, printReset);
const c = (token: string) => resolveVar(`var(${token})`, PRINT_SCOPE);
const ratio = (a: string, b: string) => Math.round(wcagContrast(a, b) * 100) / 100;

/* ══════════════════════════════════════════════════════════════════════════
 * 1. El bloque @media print de globals.css
 * ═════════════════════════════════════════════════════════════════════════ */

/** El único `{ display: none }` del bloque print: su lista de selectores. */
const listaDisplayNone = (() => {
  const print = CSS.slice(CSS.indexOf("@media print"));
  const m = /([^{}]+)\{\s*display:\s*none;\s*\}/.exec(print);
  expect(m, "el bloque print ya no tiene una lista de `display: none`").not.toBeNull();
  return m![1];
})();

describe("@media print — esconde chrome, nunca contenido (defecto [12], regresión)", () => {
  it("NINGÚN rol de ARIA se usa como proxy de 'esto es decoración'", () => {
    // `[role="status"]` y `[aria-live]` borraban la respuesta del asistente, el
    // veredicto del verificador y el comprobante de impulso — también en light.
    expect(listaDisplayNone).not.toMatch(/\[role\s*=\s*["']?status/);
    expect(listaDisplayNone).not.toMatch(/\[aria-live/);
  });

  it("los nodos con role=status / aria-live que hoy son CONTENIDO siguen existiendo", () => {
    // Si alguien vuelve a meter el selector, estos archivos son los que se apagan.
    const contenidoVivo = [
      "components/assistant/assistant-message.tsx",
      "components/escudo/verificador-form.tsx",
      "app/(app)/impulsar/[listingId]/page.tsx",
      "app/(app)/perfil/verificar/resultado/page.tsx",
    ];
    for (const archivo of contenidoVivo) {
      const src = readFileSync(resolve(SRC, archivo), "utf8");
      expect(src, `${archivo} ya no anuncia su resultado`).toMatch(/role="status"|aria-live/);
    }
  });

  it("el chrome se esconde por selector de tipo o por `.cl-print-hide`, y nada más", () => {
    const selectores = listaDisplayNone
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(selectores).toEqual([
      "header:not(main header)",
      "nav",
      "dialog",
      '[role="dialog"]',
      "button",
      '[role="button"]',
      ".cl-print-hide",
      ".skeleton",
    ]);
  });

  it("`.cl-print-fill` fuerza el relleno con print-color-adjust (y su prefijo)", () => {
    expect(CSS).toMatch(
      /\.cl-print-fill \{\s*-webkit-print-color-adjust: exact;\s*print-color-adjust: exact;\s*\}/,
    );
  });

  it("el bloque print sigue DESPUÉS de los dos caminos a dark (empate de specificity)", () => {
    // `.dark` y `@media (prefers-color-scheme: dark) :root:not(.light):not(.dark)`
    // comparten selector con el bloque print: gana el último en orden de fuente.
    const iDark = CSS.indexOf("\n.dark {");
    const iMedia = CSS.indexOf("@media (prefers-color-scheme: dark)");
    const iPrint = CSS.indexOf("@media print");
    const iForced = CSS.indexOf("@media (forced-colors: active)");
    expect(iDark).toBeGreaterThan(0);
    expect(iPrint).toBeGreaterThan(iDark);
    expect(iPrint).toBeGreaterThan(iMedia);
    expect(iForced).toBeGreaterThan(iPrint);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Por qué la familia `on-*` necesita un hook: la medición
 * ═════════════════════════════════════════════════════════════════════════ */

describe("las tintas `on-*` contra el papel (medido con culori sobre los tokens reales)", () => {
  /** Tinta clara → sin su relleno impreso es invisible. Necesita `cl-print-hide|fill`. */
  const CLARAS = [
    "--color-brand-foreground",
    "--color-on-success",
    "--color-on-danger",
    "--color-on-info",
    "--color-on-surface-inverse",
    "--color-on-media",
  ] as const;

  it.each(CLARAS)("%s NO se lee sobre papel blanco: por eso necesita hook", (token) => {
    expect(ratio(c(token), PAPEL)).toBeLessThan(AA);
  });

  it("`on-warning` es la excepción, y no por casualidad: ya es tinta oscura", () => {
    // `--cl-light-on-warning: neutral-950` — el blanco sobre el ámbar daba 3.64:1.
    expect(ratio(c("--color-on-warning"), PAPEL)).toBeGreaterThanOrEqual(7);
  });

  it("oscurecer la tinta en print NO era la solución: rompe con 'Gráficos de fondo'", () => {
    // La alternativa barata era remapear `on-*` a `foreground` dentro de @media print.
    // Cuesta cero clases y funciona… hasta que el usuario tilda "Gráficos de fondo"
    // en el diálogo de impresión: ahí el relleno SÍ se imprime y la tinta oscura cae.
    const foreground = c("--color-foreground");
    for (const fill of ["--color-brand", "--color-danger", "--color-info"] as const) {
      expect(ratio(foreground, c(fill)), `foreground sobre ${fill}`).toBeLessThan(AA);
    }
    // `print-color-adjust: exact` conserva los ratios ya validados en pantalla.
    expect(ratio(c("--color-brand-foreground"), c("--color-brand"))).toBeGreaterThanOrEqual(AA);
    expect(ratio(c("--color-on-success"), c("--color-success"))).toBeGreaterThanOrEqual(AA);
    expect(ratio(c("--color-on-danger"), c("--color-danger"))).toBeGreaterThanOrEqual(AA);
  });

  it("el body imprime tinta oscura aunque el usuario venga de dark", () => {
    expect(ratio(c("--color-foreground"), PAPEL)).toBeGreaterThanOrEqual(7);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. El inventario: ningún portador de tinta `on-*` sin clasificar
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Un test que parsea JSX para adivinar el elemento que envuelve a cada clase es
 * una fachada: falla con `cn()`, con los helpers tipo `topicChipClass()` y con los
 * `<span>` anidados adentro de un `<button>`. Así que no adivina: acá está el
 * inventario COMPLETO, verificado a mano, de cada archivo que escribe una tinta
 * `on-*`, y por qué sobrevive al papel. Si alguien agrega, quita o mueve una a
 * otro archivo, este test explota y lo obliga a clasificarla.
 */
type Cobertura =
  | "control" // es (o vive dentro de) un <button>: el @media print ya lo esconde
  | "nav" // vive dentro de un <nav>: idem
  | "header" // vive dentro del <header> sticky, que NO cuelga de <main>: idem
  | "cl-print-hide" // hook explícito de globals.css
  | "cl-print-fill" // hook explícito: se imprime CON su relleno
  | "buttonVariants" // hereda `cl-print-hide` de la base del cva
  | "sobre <img>"; // el respaldo es un <img>, que el navegador SÍ imprime

/** Dónde se DEMUESTRA la cobertura. Por default, el mismo archivo que la escribe. */
type Entrada = {
  inks: string[];
  cobertura: Cobertura;
  prueba?: { archivo: string; contiene: string[] };
};

const INVENTARIO: Record<string, Entrada> = {
  // Botón "Quitar foto" del form de publicar producto — mismo patrón que
  // /publicar/publish-form.tsx (abajo): es un <button>, el @media print ya lo esconde.
  "src/app/(app)/marketplace/publicar/publish-form.tsx": {
    inks: ["text-on-media"],
    cobertura: "control",
  },
  "src/app/(app)/publicar/publish-form.tsx": { inks: ["text-on-media"], cobertura: "control" },
  // Botón "Quitar foto" del wizard de publicar EMPLEO — idéntico patrón: es un
  // <button>, el @media print ya lo esconde.
  "src/app/(app)/empleos/publicar/publish-form.tsx": {
    inks: ["text-on-media"],
    cobertura: "control",
  },
  // Hero de la landing: el respaldo es el <picture><img> de hero-backdrop, y un
  // <img> se imprime siempre (lo que el navegador omite es `background-*`). Fuera
  // de alcance de este defecto: el usuario está revisando el hero aparte.
  "src/app/(marketing)/page.tsx": {
    inks: Array<string>(5).fill("text-on-media"),
    cobertura: "sobre <img>",
    prueba: { archivo: "src/components/marketing/hero-backdrop.tsx", contiene: ["<img"] },
  },
  // Creator Marketplace: chips de categoría/urgente/disponibilidad flotando
  // sobre la foto del aviso o del portfolio (overlay de CardMedia) + el ícono
  // del fallback violeta — mismo motivo que product-card.tsx: se imprimen con su
  // velo (bg-media-scrim + cl-print-fill).
  "src/app/(app)/creadores/[id]/page.tsx": {
    inks: Array<string>(5).fill("text-on-media"),
    cobertura: "cl-print-fill",
  },
  // El feed de trabajos ya no muestra categorías (ni chips de filtro ni selector):
  // page.tsx dejó de escribir tinta on-* — por eso ya no está en el inventario.
  // Chip "Urgente" sobre la foto del aviso + el ícono del fallback violeta (el chip
  // de categoría se quitó: no se muestran categorías en Creadores).
  "src/components/creators/gig-card.tsx": {
    inks: ["text-on-media", "text-on-media"],
    cobertura: "cl-print-fill",
  },
  "src/components/creators/creator-card.tsx": {
    inks: ["text-on-media", "text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Botón "Quitar foto" del portfolio / de las fotos del aviso — es un <button>,
  // el @media print ya lo esconde (mismo patrón que los publish-form de arriba).
  "src/components/creators/creator-profile-form.tsx": {
    inks: ["text-on-media"],
    cobertura: "control",
  },
  "src/components/creators/gig-publish-form.tsx": {
    inks: ["text-on-media"],
    cobertura: "control",
  },
  "src/components/admin/admin-nav.tsx": { inks: ["text-brand-foreground"], cobertura: "nav" },
  // Insignia redonda del selector de autoría del composer: dice con qué
  // identidad vas a publicar. Es una tinta clara sobre `bg-brand`, y el relleno
  // no se imprime — así que lleva `cl-print-hide` en su propio className, igual
  // que la insignia del header. No necesita `prueba` apuntando a otro archivo:
  // el hook está en la misma línea que la tinta.
  "src/components/feed/autoria-selector.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "cl-print-hide",
  },
  // Único portador que no es control: escudo verde sobre el avatar.
  "src/components/auth/identity-badge.tsx": {
    inks: ["text-on-success"],
    cobertura: "cl-print-fill",
  },
  // El segundo portador que no es control: el sello AZUL del check pago (0101),
  // hermano del escudo verde de arriba y con el mismo problema — es una tinta
  // clara que sólo se lee encima de su relleno. Mismo hook `cl-print-fill`, misma
  // razón: sin `print-color-adjust: exact` el tilde sale blanco sobre papel
  // blanco (1.00:1). Que una insignia desaparezca al imprimir un perfil no es
  // cosmético: la hoja diría que la cuenta NO tiene check.
  "src/components/verificacion/check-azul.tsx": {
    inks: ["text-on-info"],
    cobertura: "cl-print-fill",
  },
  // Composer de comentario. TRES tintas y DOS mecanismos, a propósito:
  //  · `text-brand-foreground` es el botón redondo de enviar — un <button>, que
  //    el @media print ya esconde en las dos superficies donde vive el composer
  //    (el detalle SSR /feed/[id] y la hoja del feed).
  //  · las dos `text-on-media` son la variante SOBRE VIDRIO del campo, y el campo
  //    es un <textarea>: la regla de <button> no lo alcanza. Sólo se renderiza
  //    con tone="media", y ese tono lo pasa ÚNICAMENTE la hoja de comentarios
  //    abierta sobre un video. De ahí que la prueba apunte a la hoja: el panel
  //    entero lleva cl-print-hide, así que esa tinta no llega nunca al papel.
  "src/components/feed/comment-composer.tsx": {
    inks: ["text-brand-foreground", "text-on-media", "text-on-media"],
    cobertura: "cl-print-hide",
    prueba: {
      archivo: "src/components/feed/comments-sheet.tsx",
      contiene: ["cl-print-hide"],
    },
  },
  // Fila del hilo. Tres de las cuatro tintas son la variante tone="media"
  // (nombre, "hace 3 min" y cuerpo sobre el vidrio). El detalle SSR /feed/[id]
  // renderiza el MISMO componente sin `tone`, o sea en tokens de tema: ahí no
  // hay `on-*` que salvar. Igual que el composer, esa variante sólo existe
  // dentro de la hoja, que es donde vive el hook.
  //
  // La cuarta es la insignia del comentario firmado por un negocio (0116),
  // hermana de la del cambiador de identidad: glifo `brand-foreground` sobre
  // `bg-brand`, con su propio `cl-print-hide` — sin el relleno queda 1.00:1, y
  // en papel el comentario ya se lee con el nombre del local al lado.
  "src/components/feed/comment-item.tsx": {
    inks: ["text-brand-foreground", ...Array<string>(3).fill("text-on-media")],
    cobertura: "cl-print-hide",
    prueba: {
      archivo: "src/components/feed/comments-sheet.tsx",
      contiene: ["cl-print-hide"],
    },
  },
  // Menú ⋯ de un comentario (0097). Su única tinta `on-*` es el botón sobre el
  // vidrio, o sea la variante tone="media", que SÓLO existe dentro de la hoja de
  // comentarios — el detalle SSR /feed/[id] monta el mismo menú sin `tone`, en
  // tokens de tema. Mismo ancla que comment-item: el panel entero lleva
  // cl-print-hide.
  "src/components/feed/comment-menu.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-hide",
    prueba: {
      archivo: "src/components/feed/comments-sheet.tsx",
      contiene: ["cl-print-hide"],
    },
  },
  // Hoja de edición (0097): el botón de quitar una foto es un círculo danger
  // sobre la miniatura. Es literalmente un <button>, así que lo cubre la regla
  // de controles del bloque print.
  "src/components/feed/post-edit-sheet.tsx": {
    inks: ["text-on-danger"],
    cobertura: "control",
  },
  // Hoja de comentarios sobre video (feedback cliente 2026-07-27): overlay modal
  // sobre TODA la página que, sobre el vidrio, escribe en tinta de media el
  // título, el contador, los dos textos del error + su botón de reintentar, los
  // dos del vacío y el CTA de entrar. Precedente exacto: media-viewer.tsx — en
  // papel una hoja de comentarios no significa nada, el panel entero lleva
  // cl-print-hide. Es también el ancla de comment-item y comment-composer.
  // La octava (0097) es el cartel de "comentarios desactivados", que ocupa el
  // lugar del campo de escribir cuando quien publicó cerró el hilo.
  //
  // Eran NUEVE hasta el 2026-08-20. La que se fue es la del CTA de entrar: dejó
  // de ser un <Link> con las clases escritas a mano y pasó a ser un <Button>
  // que reusa ON_MEDIA_BUTTON —la misma cadena, ya inventariada acá arriba—
  // cuando abre la hoja de autenticación sin sacar a nadie del feed. Una tinta
  // menos en el conteo, cero cambios en lo que se ve.
  "src/components/feed/comments-sheet.tsx": {
    inks: Array<string>(8).fill("text-on-media"),
    cobertura: "cl-print-hide",
  },
  // Hoja de composición (2026-07-27). REEMPLAZA a post-composer.tsx, que salió
  // del inventario: el chip de duración del video y el botón "Quitar" se mudaron
  // acá, y se les sumó la encuesta de la vista previa (las píldoras Sí/No y su
  // pie). Otro overlay modal, y encima uno donde se ESCRIBE una publicación: en
  // papel no existe. cl-print-hide en el panel, mismo criterio que la hoja de
  // comentarios y el visor.
  "src/components/feed/composer-sheet.tsx": {
    inks: Array<string>(4).fill("text-on-media"),
    cobertura: "cl-print-hide",
  },
  // Insignia de negocio de la tarjeta "¿Qué querés publicar?" (0116): el mismo
  // <span aria-hidden> con el glifo en `brand-foreground` sobre `bg-brand` que
  // usa el cambiador del header, acá para decir que vas a publicar como tu
  // local. Lleva su propio `cl-print-hide` por el mismo motivo que aquél: sin
  // el relleno queda 1.00:1, y con qué perfil estabas navegando no significa
  // nada en una hoja impresa.
  "src/components/feed/composer-trigger.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "cl-print-hide",
  },
  // Insignia de una reseña firmada por un negocio (0117): el mismo glifo
  // `brand-foreground` sobre `bg-brand` del cambiador de identidad, acá sobre el
  // avatar de quien opinó. Con su `cl-print-hide` — sin el relleno queda 1.00:1,
  // y en papel la reseña ya se lee con el nombre del local arriba.
  "src/components/resenas/resenas-lista.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "cl-print-hide",
  },
  // Música de una publicación, a la vista (0090): la píldora "♪ Título ·
  // Artista" (y, si la licencia lo exige, la línea de atribución debajo) flota
  // sobre la foto/video, así que escribe tinta on-media — mismo problema que
  // el contador del carrusel. Ya trae su propio cl-print-fill en las DOS
  // píldoras (no una: la de atribución es opcional y necesita el mismo
  // relleno impreso que la principal).
  "src/components/feed/music-badge.tsx": {
    inks: ["text-on-media", "text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Elegir música para una publicación (0090): la fila ya elegida es un
  // <button> que abre la hoja para cambiarla — el ícono de nota vive en tinta
  // de tema (`text-brand-ink`, fuera de este inventario), pero el círculo de
  // Reproducir/Pausar de cada fila DENTRO de la hoja es la MISMA tinta que el
  // resto de los controles-pastilla del sistema (`bg-brand text-brand-foreground`
  // cuando está sonando), y también es un <button>. La hoja entera además
  // lleva `cl-print-hide` (no hace falta: el botón ya alcanza).
  "src/components/feed/music-picker.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  // Etiquetar personas — el selector (migración 0089): la marca de
  // seleccionado/no-seleccionado de cada resultado es un <span aria-hidden>
  // DENTRO de `PersonRow`, que es un <button>. El @media print ya lo esconde.
  "src/components/feed/people-tagger.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  // Editor de foto del composer rápido (§2/§3 filtros y texto, feedback
  // cliente 2026-07-27): la vista previa en vivo del texto que se va a QUEMAR
  // sobre la foto (`PhotoCaptionOverlay`) escribía tinta on-media sobre un velo.
  //
  // SALIÓ DEL INVENTARIO (2026-08-26): el texto sobre la foto pasó a poder
  // elegir COLOR (photo-overlay.ts), así que su tinta dejó de ser el token
  // `on-media` y pasó a ser un valor literal en `style.color` — el mismo que
  // `bake-photo.ts` quema en el JPEG, que es justamente el punto: el archivo
  // publicado no puede depender de un token que cambia con el tema. La
  // cobertura de papel no cambió y sigue siendo la misma que estaba anotada
  // acá: `PhotoEditor` sólo se monta dentro del `BottomSheet` de
  // `ComposerSheet`, que lleva `cl-print-hide` entero (es la hoja donde se
  // COMPONE una publicación: en papel no existe).
  // Carrusel de medios (2026-07-27). Dos tintas, dos mecanismos:
  //  · el contador "7/12" del indicador se apoya en un velo (bg-media-scrim):
  //    sin ese relleno impreso queda en 1.00:1. El hook va en el CONTENEDOR del
  //    indicador y no en la píldora, porque `print-color-adjust` SE HEREDA: así
  //    cubre también la otra forma del indicador, los puntitos, que son
  //    `bg-on-media` puro y sin el hook desaparecerían igual. Mismo patrón que
  //    la píldora de vistas de card-video.tsx;
  //  · la otra vive dentro del <button> de la flecha: el @media print ya lo tapa.
  "src/components/feed/media-carousel.tsx": {
    inks: ["text-on-media", "text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Rediseño red social (2026-07-21) — la foto 4:5 es la protagonista. Bajó a UNA
  // sola tinta (2026-07-27): el contador "N fotos" se mudó al carrusel y el
  // archivo ya ni renderiza <img> (los medios los pinta MediaCarousel), así que
  // la cobertura vieja "sobre <img>" tampoco se podía sostener. Lo único que le
  // queda es el corazón grande del doble toque: decorativo y TRANSITORIO —vive
  // lo que dura la animación—, y aun así lleva cl-print-hide explícito. Un
  // destello blanco en 1.00:1 no tiene nada que hacer en una hoja impresa.
  "src/components/feed/card-post-media.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-hide",
  },
  // Banner de las publicaciones tipo "Pregunta" (feedback cliente 2026-07-26):
  // la pregunta se compone como tinta clara sobre un campo de marca, así que sin
  // ese relleno impreso queda en 1.00:1 sobre el papel. UNA sola ocurrencia a
  // propósito: la tinta se declara en la raíz del banner y todo lo de adentro
  // (los signos ¿ ?, la píldora "ver completa", el corazón del doble toque) la
  // hereda por currentColor. El hook va en esa misma raíz.
  "src/components/feed/question-banner.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Hermano de QuestionBanner para `kind='text'` (2026-07-29): mismo motivo,
  // mismo hook en la misma raíz — tinta clara sobre el campo de marca.
  "src/components/feed/text-banner.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Encuesta Sí/No de una pregunta (0041). Sus dos tintas son el tono "media", y
  // ese tono se pasa en UN solo lugar: post-card.tsx usa tone="media" justo
  // cuando la encuesta va DENTRO del QuestionBanner (si la pregunta trae foto, la
  // encuesta baja al cuerpo de la card y se pinta con tokens de tema). El relleno
  // propio de la barra no la salva —`on-media/12` es un velo translúcido, no un
  // color—: lo que tiene que imprimirse es el campo de marca del banner, y ese
  // hook ya está declarado en su raíz. Como `print-color-adjust` SE HEREDA (lo
  // documenta el propio bloque print de globals.css), cubre la encuesta entera,
  // incluido el pie de "45 votos", que queda FUERA de los <button> y por eso no
  // alcanzaba con la cobertura "control".
  "src/components/feed/poll-yes-no.tsx": {
    inks: ["text-on-media", "text-on-media"],
    cobertura: "cl-print-fill",
    prueba: {
      archivo: "src/components/feed/question-banner.tsx",
      contiene: ["cl-print-fill"],
    },
  },
  // Video del feed, DOS portadores y ninguno llega al papel: la píldora de
  // vistas se imprime con su velo (cl-print-fill) y el corazón del doble-tap es
  // transitorio (sólo existe mientras dura la animación). El hook explícito es
  // el de la píldora.
  //
  // ERAN TRES hasta el 2026-08-26: el altavoz se mudó a `post-music.tsx`, un
  // nivel más arriba, cuando la música pasó a ser de la PUBLICACIÓN y no de un
  // medio (bug del cliente: una publicación de fotos con música no tenía
  // ningún altavoz que tocar). Sigue siendo un <button>, así que su cobertura
  // no cambió — cambió de archivo.
  "src/components/feed/card-video.tsx": {
    inks: ["text-on-media", "text-on-media"],
    cobertura: "cl-print-fill",
  },
  // El altavoz de la publicación (0090). Es un <button>, y el bloque de
  // `@media print` esconde los controles: en una hoja impresa un botón de
  // sonido no significa nada.
  "src/components/feed/post-music.tsx": {
    inks: ["text-on-media"],
    cobertura: "control",
  },
  // feed-listing-card.tsx y listings/listing-card.tsx SALIERON del inventario
  // (2026-07-26): su título/precio/zona pasó a heredar la tinta de
  // <MediaScrimBottom>, que la declara UNA vez en card-media.tsx (ya inventariado
  // ahí, cobertura "sobre <img>"). Las cards dejaron de escribir `on-*` propias —
  // que era justo el objetivo de centralizar la franja de vidrio.
  // Visor de medios fullscreen: overlay modal sobre TODA la página — en papel
  // no significa nada, el panel entero lleva cl-print-hide.
  "src/components/feed/media-viewer.tsx": {
    inks: Array<string>(5).fill("text-on-media"),
    cobertura: "cl-print-hide",
  },
  // Menú de entrada de Videos Cortos (2026-07-30): el glifo Play del acceso
  // "Todos los videos" sobre el círculo de marca. Es la ÚNICA tinta clara de la
  // pantalla —las tarjetas de categoría escriben `foreground`— y se imprime con
  // su relleno.
  "src/app/(app)/videos/category-menu.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "cl-print-fill",
  },
  // Reels /videos: superficie de video fullscreen (fixed, bg-media-shade) — el
  // contenedor raíz entero lleva cl-print-hide; imprimir reels no existe.
  // 9 tras quitar los chips de scope del reel (commit cba8e0b): el inventario
  // había quedado en 10 y desactualizó este guard. 11 desde 2026-07-26: suma el
  // contador de vistas junto al autor y el corazón del doble-tap. 12 desde
  // 2026-07-30: la cápsula de categoría activa, que además es la salida al menú.
  // De vuelta a 11 el 2026-08-26: se cayó el "por {persona}" que el reel
  // imprimía debajo del nombre del negocio. No fue un ajuste de diseño — era la
  // misma fuga de privacidad que se cerró en la tarjeta del feed (ver el
  // docblock de `EntityHeader` en post-card.tsx): un video publicado como
  // negocio delataba el nombre y apellido de quien está detrás.
  "src/app/(app)/videos/video-reels.tsx": {
    inks: Array<string>(11).fill("text-on-media"),
    cobertura: "cl-print-hide",
  },
  // Dos tintas, mismo patrón: el glifo Play sobre el thumbnail de video y el
  // rótulo "Fijada" de la publicación fijada (0097). Las dos se apoyan en un
  // velo bg-media-scrim y las dos lo imprimen con cl-print-fill, como el
  // contador de gallery.
  "src/app/(app)/perfil/posts-grid.tsx": {
    inks: ["text-on-media", "text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Glifo Play sobre el thumbnail de video en el índice de Impulsar — mismo
  // patrón que posts-grid.tsx: velo bg-media-scrim con cl-print-fill.
  "src/app/(app)/impulsar/page.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Guardados del perfil: el mismo glifo Play sobre el thumbnail del video que
  // guardaste, y el mismo hook (el velo bg-media-scrim ya venía con cl-print-fill
  // puesto). Espejo de posts-grid.tsx.
  "src/app/(app)/perfil/guardados/saved-list.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Dos flechas <button> + el contador "3 / 7", que se imprime con su velo.
  "src/components/listings/gallery.tsx": {
    inks: ["text-on-media", "text-on-media", "text-on-media"],
    cobertura: "cl-print-fill",
  },
  "src/components/marketing/guides-explorer.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  "src/components/marketing/language-toggle.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  // Ícono decorativo del banner "para dueños" de /marketplace — mismo hook que
  // IdentityBadge: escudo/megáfono claro sobre un relleno de acento sólido.
  "src/components/marketplace/owner-banner.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Chip de categoría flotando sobre la foto de la card de producto (overlay
  // de CardMedia) — mismo motivo que el chip de arriba.
  "src/components/marketplace/product-card.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-fill",
  },
  // Contador "2/4" de la galería del detalle de producto — mismo patrón que
  // listings/gallery.tsx: se imprime con su velo (bg-media-scrim + cl-print-fill).
  "src/components/marketplace/product-gallery.tsx": {
    inks: ["text-on-media"],
    cobertura: "cl-print-fill",
  },
  "src/components/messaging/composer.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  // Contacto inline (call cliente 2026-07-24, extendido a las cuatro pantallas
  // el 2026-08-20): mismo composer que el hilo de Mensajes, embebido en la
  // publicación, el perfil o la card. Único portador = el botón redondo de
  // enviar, un <button>. El CTA colapsado es un <Button>, que ya trae su propio
  // cl-print-hide vía buttonVariants.
  //
  // La tinta se mudó acá desde listings/inline-message-cta.tsx: ese archivo
  // ahora sólo aporta copy y delega el markup en este componente compartido.
  "src/components/messaging/inline-contact.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  // Contador de notificaciones sin leer de /ajustes (2026-07-29): vive en una
  // fila de <main>, así que no lo alcanza ninguna regla de chrome. Lleva
  // `cl-print-hide` propio — un número de avisos pendientes no significa nada
  // en papel, y sin el hook sería blanco sobre blanco.
  // La segunda tinta es el ícono redondo de la fila "Crear cuenta de negocio"
  // (0103): un <span aria-hidden> con el glifo en `brand-foreground` sobre
  // `bg-brand`. Mismo caso que el contador y mismo hook — decoración de una fila
  // de Ajustes, que en papel no dice nada y sin el relleno sería invisible.
  "src/app/(app)/ajustes/page.tsx": {
    inks: ["text-brand-foreground", "text-brand-foreground"],
    cobertura: "cl-print-hide",
  },
  // Píldora "Cerrado / Abierto / Las 24 horas" del editor de horarios (0093):
  // el portador es un <label> de un radio `sr-only`, no un <button>, así que el
  // @media print no lo alcanza y sin hook queda blanco sobre blanco. Lleva
  // `cl-print-hide` propio — un selector de formulario tampoco significa nada
  // impreso en papel.
  "src/components/negocios/horario-editor.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "cl-print-hide",
  },
  // Fila "Quién puede etiquetarte" de Ajustes › Privacidad (migración 0089): el
  // tilde de la opción activa vive dentro de un <button role="radio">, que el
  // @media print ya esconde — mismo criterio que el resto de los radios/chips
  // de este archivo.
  "src/app/(app)/ajustes/privacidad/tag-policy-row.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  // Pestañas de /notificaciones (2026-07-30): el contador de la pestaña activa
  // es la MISMA tinta que el badge de /ajustes, con el mismo problema y la misma
  // salida. El hook va en el contenedor de toda la tira, no en el número: una
  // barra de pestañas impresa es chrome que no dice nada, y esconder sólo el
  // contador dejaría media pestaña.
  "src/components/notifications/category-tabs.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "cl-print-hide",
  },
  // Filtro Todas/No leídas/Importantes: el chip activo se pinta con la tinta
  // inversa. Mismo criterio — el grupo entero es chrome de navegación.
  "src/components/notifications/inbox-filters.tsx": {
    inks: ["text-on-surface-inverse"],
    cobertura: "cl-print-hide",
  },
  // Campana del header: el número del badge de sin-leer se apoya en
  // `bg-danger`, así que su tinta clara necesita relleno impreso o queda en
  // 1.00:1. NO es "control": el badge no es un botón, es un adorno dentro del
  // botón que abre la gaveta (`aria-hidden`; el conteo se anuncia en el
  // `aria-label`). Tampoco es "nav": el header del shell no es un `<nav>`. Lo
  // que sí es, literalmente, es `<header>` — y es el header STICKY del shell
  // autenticado (`components/shell/header.tsx`), que vive ANTES de `<main>` en
  // `(app)/layout.tsx`, así que cae bajo `header:not(main header)` del bloque
  // print: el header entero desaparece en papel, campana incluida.
  //
  // El PANEL que cuelga de esa campana se portala a `document.body`, así que en
  // papel no lo cubriría ese selector — pero tampoco hace falta: sólo existe
  // mientras está abierto, y nadie imprime con la gaveta abierta. Adentro del
  // panel no se escribe ninguna tinta `on-*`.
  "src/components/notifications/notification-panel.tsx": {
    inks: ["text-on-danger"],
    cobertura: "header",
    prueba: {
      archivo: "src/components/shell/header.tsx",
      contiene: ["<header"],
    },
  },
  "src/components/onboarding/onboarding-wizard.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "control",
  },
  // Distintivo del cambiador de identidad (0103): un <span aria-hidden> con el
  // glifo en `brand-foreground` sobre `bg-brand`, pegado al avatar del header.
  // Lleva `cl-print-hide` propio — sin el relleno quedaría 1.00:1, y con qué
  // perfil estabas navegando no significa nada en una hoja impresa.
  "src/components/shell/identity-switcher.tsx": {
    inks: ["text-brand-foreground"],
    cobertura: "cl-print-hide",
  },
  "src/components/shell/offline-banner.tsx": {
    inks: ["text-on-surface-inverse"],
    cobertura: "cl-print-hide",
  },
  "src/components/ui/button.tsx": {
    inks: ["text-brand-foreground", "text-on-danger"],
    cobertura: "buttonVariants",
  },
  // Primitivo CardMedia: la franja overlayBottom (bg-media-scrim + text-on-media)
  // se dibuja sobre el <img>/Image, que sí se imprime (el navegador omite el
  // background del velo, no la foto). Mismo criterio que el hero de la landing.
  "src/components/ui/card-media.tsx": {
    inks: ["text-on-media"],
    cobertura: "sobre <img>",
  },
};

/** Qué substring prueba cada cobertura cuando la entrada no trae `prueba` propia. */
const PRUEBA_POR_DEFECTO: Record<Cobertura, string[]> = {
  control: ["<button"],
  nav: ["<nav"],
  header: ["<header"],
  "cl-print-hide": ["cl-print-hide"],
  "cl-print-fill": ["cl-print-fill"],
  buttonVariants: ["cl-print-hide"],
  "sobre <img>": ["<img"],
};

const RE_INK =
  /\btext-(brand-foreground|on-success|on-danger|on-info|on-surface-inverse|on-media)\b/g;

/**
 * Borra comentarios conservando offsets. `src[i-1] !== ":"` deja pasar el `//` de
 * `https://`, que si no se comería el resto de la línea.
 */
function soloCodigo(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("/*", i)) {
      const fin = src.indexOf("*/", i + 2);
      const hasta = fin < 0 ? src.length : fin + 2;
      out += src.slice(i, hasta).replace(/[^\n]/g, " ");
      i = hasta;
      continue;
    }
    if (src.startsWith("//", i) && src[i - 1] !== ":") {
      const salto = src.indexOf("\n", i);
      const hasta = salto < 0 ? src.length : salto;
      out += " ".repeat(hasta - i);
      i = hasta;
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

function archivosTsx(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const full = join(dir, nombre);
    if (statSync(full).isDirectory()) archivosTsx(full, acc);
    else if (/\.tsx$/.test(nombre) && !/\.test\.tsx$/.test(nombre)) acc.push(full);
  }
  return acc;
}

const encontrado: Record<string, string[]> = {};
for (const archivo of archivosTsx(SRC)) {
  const hits = [...soloCodigo(readFileSync(archivo, "utf8")).matchAll(RE_INK)].map((m) => m[0]);
  if (hits.length) encontrado[relative(ROOT, archivo).split(sep).join("/")] = hits.sort();
}

describe("inventario de tintas `on-*` — nadie las escribe sin decir cómo sobrevive al papel", () => {
  it("los archivos que las escriben son EXACTAMENTE los del inventario", () => {
    const esperado = Object.fromEntries(
      Object.entries(INVENTARIO).map(([f, { inks }]) => [f, [...inks].sort()]),
    );
    expect(encontrado).toEqual(esperado);
  });

  it.each(Object.entries(INVENTARIO))(
    "%s: la cobertura declarada existe de verdad en el código",
    (archivo, entrada) => {
      const prueba = entrada.prueba ?? {
        archivo,
        contiene: PRUEBA_POR_DEFECTO[entrada.cobertura],
      };
      const fuente = readFileSync(resolve(ROOT, prueba.archivo), "utf8");
      for (const aguja of prueba.contiene) {
        expect(fuente, `${prueba.archivo} debería probar "${entrada.cobertura}"`).toContain(aguja);
      }
    },
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. buttonVariants: el <a> con pinta de botón también es chrome
 * ═════════════════════════════════════════════════════════════════════════ */

describe("buttonVariants lleva el hook — el CTA de /guias/[slug] es un <a>, no un <button>", () => {
  it("la base lo emite en los cuatro variants", () => {
    for (const variant of ["primary", "secondary", "outline", "ghost", "danger"] as const) {
      expect(buttonVariants({ variant })).toContain("cl-print-hide");
    }
  });

  it("`primary` sigue siendo `bg-brand text-brand-foreground`: sin hook, 1.00:1 en papel", () => {
    expect(buttonVariants({ variant: "primary" })).toContain("bg-brand");
    expect(buttonVariants({ variant: "primary" })).toContain("text-brand-foreground");
    expect(ratio(c("--color-brand-foreground"), PAPEL)).toBe(1);
  });

  it("tailwind-merge no se lo come al componer clases en el call site", () => {
    // `cn(buttonVariants({...}), "w-full")` y `cn(…, "flex")` son patrones reales:
    // el segundo pisa `inline-flex`, y el hook tiene que seguir ahí igual.
    expect(cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")).toContain(
      "cl-print-hide",
    );
    expect(cn(buttonVariants({ variant: "outline" }), "flex border-on-media/40")).toContain(
      "cl-print-hide",
    );
  });
});
