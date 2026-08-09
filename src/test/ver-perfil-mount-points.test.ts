import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * CONTRATO — "Ver perfil" se ofrece en TODOS los puntos de montaje, no en
 * algunos.
 *
 * La gramática de UX del proyecto es fija (docs/feedback, call del 29/7):
 *  - tocar una card NUNCA navega fuera del feed;
 *  - "ver perfil" vive en la hoja del Trust Score, no en el nombre del autor.
 *
 * O sea que `<PublisherTrust>` es la ÚNICA puerta al perfil de quien publica.
 * Cuando una card lo monta sin `profileId`, esa puerta no existe en esa
 * pantalla — y no se nota, porque el badge se ve idéntico: sigue mostrando el
 * score, sigue abriendo la hoja, sólo que la hoja llega sin salida. Es un
 * agujero silencioso, y por eso lo cuida un test de contrato y no la revisión
 * a ojo: así se cablearon 12 de 22 montajes y nadie vio los 10 que faltaban.
 *
 * `publisher-trust.test.tsx` prueba que el prop PRODUCE el link; este test
 * prueba que TODAS las pantallas lo pasan. Hacen falta los dos.
 *
 * SI ESTE TEST FALLA: pasale `profileId` al montaje nuevo. Si de verdad no hay
 * perfil detrás (aviso de fuente externa, seed sin cuenta), pasá
 * `profileId={null}` explícito — el componente ya trata null como "sin botón" y
 * dejarlo escrito documenta que fue una decisión, no un olvido.
 */

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

function collectFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectFiles(full));
    } else if (entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

/** Cada `<PublisherTrust ... />` del repo, con su archivo y su línea. */
const mountPoints = collectFiles(SRC_DIR)
  .filter((file) => !file.endsWith(".test.tsx"))
  // El componente en sí no se monta a sí mismo.
  .filter((file) => !file.endsWith(join("listings", "publisher-trust.tsx")))
  .flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const mounts: { file: string; line: number; jsx: string }[] = [];
    const re = /<PublisherTrust\b[\s\S]*?\/>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      mounts.push({
        file: file.slice(SRC_DIR.length),
        line: source.slice(0, match.index).split("\n").length,
        jsx: match[0],
      });
    }
    return mounts;
  });

describe('"Ver perfil": la hoja del Trust Score siempre tiene salida', () => {
  it("hay montajes que revisar (si no, el test se volvió decorativo)", () => {
    expect(mountPoints.length).toBeGreaterThan(0);
  });

  it("todo <PublisherTrust> recibe profileId", () => {
    const offenders = mountPoints
      // Un montaje que pasa sus props con spread (`{...store.trust}`) no se
      // puede leer con una expresión regular: lo que hay que garantizar ahí es
      // el TIPO del objeto que se esparce, y eso ya lo exige `tsc` (ver
      // `StoreCardModel["trust"]`, donde `profileId` es requerido a propósito).
      .filter(({ jsx }) => !/\{\s*\.\.\./.test(jsx))
      .filter(({ jsx }) => !/\bprofileId=/.test(jsx))
      .map(({ file, line }) => `${file}:${line}`);

    expect(
      offenders,
      'sin `profileId` la hoja del Trust Score se abre sin "Ver perfil" y la persona no tiene cómo revisar quién publica',
    ).toEqual([]);
  });
});
