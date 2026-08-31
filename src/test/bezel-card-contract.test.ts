import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * CONTRATO — `<BezelCard>` tiene DOS lugares donde poner clases, y no son
 * intercambiables:
 *
 *   · `className`     → el MARCO (el bisel exterior: `rounded-xl p-1.5`).
 *   · `coreClassName` → el CONTENIDO (el core interior, `p-6` por default).
 *
 * Mandar padding o layout al marco no tira ningún error: tipa, buildea, pasa
 * lint, y la pantalla sale rota. Dos formas, las dos vistas en producción:
 *
 *  1. PADDING QUE SE SUMA. `p-4` en el marco no reemplaza al `p-6` del core:
 *     lo engorda a ÉL. El bisel pasa de 6px a 16px y el contenido queda con
 *     16 + 24 = 40px de aire por lado. La tarjeta se ve inflada y desalineada
 *     contra sus hermanas, pero como sigue siendo una tarjeta, se lee como
 *     "diseño" y no como defecto.
 *
 *  2. LAYOUT QUE NO HACE NADA. `flex flex-col gap-3` en el marco es un no-op:
 *     el marco tiene UN solo hijo (el core). Los elementos que se querían
 *     separar viven adentro del core, que sigue siendo un `div` en flujo
 *     normal — gap 0, todo pegado. Lo mismo con `items-*` y `justify-*`, que
 *     sin un `display: flex` real ni siquiera se aplican.
 *
 * Ninguno de los dos aparece en un stack trace: los reportó el cliente, mirando
 * /verificacion y /negocios/cuenta (7 call sites, 31/8). Por eso el guardia es
 * un test de contrato y no la revisión a ojo — a ojo pasaron.
 *
 * SI ESTE TEST FALLA: mové esas clases de `className` a `coreClassName`. La
 * regla corta rápido — ¿la clase habla de los HIJOS de la tarjeta (padding
 * interior, flex, grid, gap, items, justify)? Va al core. ¿Habla de la tarjeta
 * como bloque dentro de SU página (`mt-6`, `w-full`, `h-full`, `max-w-2xl`,
 * `flex-1`, borde, sombra)? Esa sí va al marco, y por eso el detector no la
 * toca.
 */

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * Clases que hablan de los hijos. En el marco, o se suman al padding del core
 * (1) o son un no-op (2).
 *
 * Lo que queda AFUERA a propósito, porque en el marco sí significa algo:
 *   · `flex-1`, `flex-none`, `flex-auto`, `basis-*`, `shrink-*`, `grow-*`:
 *     dicen cómo se dimensiona la tarjeta dentro de su propio contenedor.
 *   · `justify-self-*`, `self-*`, `col-span-*`: la ubican como hija de una
 *     grilla ajena.
 */
const REGLAS: { re: RegExp; motivo: string }[] = [
  { re: /^p(?:[xytrbles])?-/, motivo: "padding: se suma al p-6 del core" },
  { re: /^(?:inline-)?(?:flex|grid)$/, motivo: "display: el marco tiene un solo hijo" },
  { re: /^flex-(?:row|col|wrap|nowrap)/, motivo: "layout: el marco tiene un solo hijo" },
  { re: /^grid-(?:cols|rows|flow)-/, motivo: "layout: el marco tiene un solo hijo" },
  { re: /^gap(?:-[xy])?-/, motivo: "gap: el marco tiene un solo hijo" },
  { re: /^space-[xy]-/, motivo: "separación entre hijos: el marco tiene un solo hijo" },
  { re: /^items-/, motivo: "alinea hijos: sin flex/grid real, no se aplica" },
  { re: /^justify-(?!self-)/, motivo: "alinea hijos: sin flex/grid real, no se aplica" },
];

/**
 * Borra comentarios conservando offsets, para que los números de línea sigan
 * siendo los del archivo. `src[i - 1] !== ":"` deja pasar el `//` de `https://`.
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

/**
 * El tag de apertura completo, no la línea. Un `<BezelCard>` puede abrirse en
 * una línea y cerrar el tag cuatro más abajo (pasa en 6 call sites reales), así
 * que buscar por línea deja pasar justo los casos con muchos props — los mismos
 * que más se prestan a confundir los dos className.
 *
 * Se cuentan llaves y se respetan las comillas porque un `>` puede vivir dentro
 * de una expresión (`variant={a > b ? "x" : "y"}`) sin cerrar el tag.
 */
function tagsDeApertura(src: string): { desde: number; tag: string }[] {
  const encontrados: { desde: number; tag: string }[] = [];
  for (const m of src.matchAll(/<BezelCard(?=[\s/>])/g)) {
    const desde = m.index;
    let i = desde + m[0].length;
    let llaves = 0;
    let comilla: string | null = null;
    while (i < src.length) {
      const c = src[i];
      if (comilla) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === comilla) comilla = null;
      } else if (c === '"' || c === "'" || c === "`") {
        comilla = c;
      } else if (c === "{") {
        llaves++;
      } else if (c === "}") {
        llaves--;
      } else if (c === ">" && llaves === 0) {
        break;
      }
      i++;
    }
    encontrados.push({ desde, tag: src.slice(desde, i) });
  }
  return encontrados;
}

/**
 * El valor del prop `className` — y sólo de ése. El lookbehind es lo que evita
 * el falso positivo más obvio: `coreClassName` termina en `className`, y un
 * `coreClassName="flex flex-col gap-3"` en la misma línea (o en el mismo tag)
 * es exactamente lo que el contrato pide, no lo que prohíbe.
 */
function valorDeClassName(tag: string): string | null {
  const m = /(?<![\w$])className\s*=\s*/.exec(tag);
  if (!m) return null;
  let i = m.index + m[0].length;
  const abre = tag[i];
  if (abre === '"' || abre === "'") {
    const cierra = tag.indexOf(abre, i + 1);
    return cierra < 0 ? null : tag.slice(i + 1, cierra);
  }
  if (abre !== "{") return null;
  // Expresión: `cn("w-full", className)`, un ternario, un template. Sólo se
  // pueden juzgar los literales que tenga adentro; un `className={className}`
  // no aporta nada que leer y sale con las manos vacías, que es lo correcto.
  let llaves = 0;
  let comilla: string | null = null;
  const desde = i;
  for (; i < tag.length; i++) {
    const c = tag[i];
    if (comilla) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") comilla = c;
    else if (c === "{") llaves++;
    else if (c === "}" && --llaves === 0) break;
  }
  const expr = tag.slice(desde + 1, i);
  return [...expr.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)]
    .map((lit) => lit[1] ?? lit[2] ?? lit[3])
    .join(" ");
}

/**
 * La clase sin sus variantes: `sm:p-5` → `p-5`, `group-hover:flex` → `flex`.
 * El corte busca el ÚLTIMO `:` de nivel cero, así que `[&:hover]:p-4` y
 * `duration-(--duration-fast)` sobreviven enteros y no se parten al medio.
 */
function claseBase(clase: string): string {
  let nivel = 0;
  let corte = -1;
  for (let i = 0; i < clase.length; i++) {
    const c = clase[i];
    if (c === "[" || c === "(") nivel++;
    else if (c === "]" || c === ")") nivel--;
    else if (c === ":" && nivel === 0) corte = i;
  }
  return clase.slice(corte + 1).replace(/^!/, "");
}

interface Infraccion {
  linea: number;
  clase: string;
  motivo: string;
}

/** El detector, aislado del disco para poder probarlo a él también. */
function revisarFuente(src: string): Infraccion[] {
  const codigo = soloCodigo(src);
  const infracciones: Infraccion[] = [];
  for (const { desde, tag } of tagsDeApertura(codigo)) {
    const valor = valorDeClassName(tag);
    if (!valor) continue;
    const linea = codigo.slice(0, desde).split("\n").length;
    for (const clase of valor.split(/\s+/).filter(Boolean)) {
      const regla = REGLAS.find((r) => r.re.test(claseBase(clase)));
      if (regla) infracciones.push({ linea, clase, motivo: regla.motivo });
    }
  }
  return infracciones;
}

function archivosTsx(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const full = join(dir, nombre);
    if (statSync(full).isDirectory()) archivosTsx(full, acc);
    else if (nombre.endsWith(".tsx") && !nombre.endsWith(".test.tsx")) acc.push(full);
  }
  return acc;
}

const CALL_SITES = archivosTsx(SRC_DIR).flatMap((archivo) => {
  const src = readFileSync(archivo, "utf8");
  const relativo = archivo.slice(SRC_DIR.length).split("\\").join("/");
  return revisarFuente(src).map((i) => `src/${relativo}:${i.linea} → ${i.clase} (${i.motivo})`);
});

const TAGS_TOTALES = archivosTsx(SRC_DIR).reduce(
  (n, archivo) => n + tagsDeApertura(soloCodigo(readFileSync(archivo, "utf8"))).length,
  0,
);

describe("<BezelCard>: el padding y el layout van en `coreClassName`, no en `className`", () => {
  it("hay call sites que revisar (si no, el test se volvió decorativo)", () => {
    expect(TAGS_TOTALES).toBeGreaterThan(0);
  });

  it("ningún `className` del marco lleva clases que son del contenido", () => {
    expect(
      CALL_SITES,
      "`className` viste el MARCO: un padding ahí se SUMA al p-6 del core (6px → 40px de aire) " +
        "y un flex/grid/gap ahí es un no-op, porque el marco tiene un solo hijo. " +
        "Mové esas clases a `coreClassName`; en `className` dejá sólo lo que ubica a la " +
        "tarjeta en su página (mt-*, w-full, h-full, borde, sombra).",
    ).toEqual([]);
  });
});

describe("el detector: lo que caza y lo que deja pasar", () => {
  it("caza el padding en el marco, aunque el tag abarque varias líneas", () => {
    const src = `
      <BezelCard
        key={negocio.businessId}
        className="mt-6 p-4"
      >
        <p>hola</p>
      </BezelCard>`;
    expect(revisarFuente(src).map((i) => i.clase)).toEqual(["p-4"]);
  });

  it("caza el layout que en el marco no hace nada", () => {
    const src = `<BezelCard className="flex flex-col items-start gap-3">x</BezelCard>`;
    expect(revisarFuente(src).map((i) => i.clase)).toEqual([
      "flex",
      "flex-col",
      "items-start",
      "gap-3",
    ]);
  });

  it("no marca el uso correcto: todo eso mismo, pero en `coreClassName`", () => {
    const src = `<BezelCard variant="featured" className="mt-6" coreClassName="flex flex-col gap-3 p-5">x</BezelCard>`;
    expect(revisarFuente(src)).toEqual([]);
  });

  it("no marca un `coreClassName` solo, sin `className` que leer", () => {
    const src = `<BezelCard coreClassName="flex items-start gap-3 p-4">x</BezelCard>`;
    expect(revisarFuente(src)).toEqual([]);
  });

  it("no confunde palabras que EMPIEZAN parecido con padding o con flex", () => {
    const src = `<BezelCard className="pointer-events-none place-self-end flex-1 shrink-0 justify-self-end scroll-mt-20">x</BezelCard>`;
    expect(revisarFuente(src)).toEqual([]);
  });

  it("no se marea con paréntesis, corchetes ni `>` dentro de una expresión", () => {
    const src = `<BezelCard
      variant={a > b ? "success" : "default"}
      className="h-full duration-(--duration-fast) group-focus-visible:ring-2 [&:hover]:shadow-md"
    >x</BezelCard>`;
    expect(revisarFuente(src)).toEqual([]);
  });

  it("mira adentro de `cn(...)` y de los templates, y aguanta el variante `sm:`", () => {
    const src = "<BezelCard className={cn(`w-full sm:p-5`, className)}>x</BezelCard>";
    expect(revisarFuente(src).map((i) => i.clase)).toEqual(["sm:p-5"]);
  });

  it("no lee un `<BezelCard>` comentado", () => {
    const src = `
      {/* <BezelCard className="flex p-4">viejo</BezelCard> */}
      <BezelCard coreClassName="p-4">x</BezelCard>`;
    expect(revisarFuente(src)).toEqual([]);
  });

  it("reporta la línea del tag, no la del prop", () => {
    const src = `uno\ndos\n<BezelCard\n  className="p-4"\n>x</BezelCard>`;
    expect(revisarFuente(src)).toEqual([
      { linea: 3, clase: "p-4", motivo: "padding: se suma al p-6 del core" },
    ]);
  });
});
