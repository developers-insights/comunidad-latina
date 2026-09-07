import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * =============================================================================
 * EL SDK DE AGORA NO PUEDE ENTRAR AL BUNDLE INICIAL
 * =============================================================================
 *
 * `agora-rtc-sdk-ng` pesa cerca de un megabyte. La regla del módulo es que se
 * baje con `import()` DENTRO de una función, y sólo cuando arranca una llamada:
 * de lo contrario lo pagan en datos móviles todos los que abren Mensajes para
 * leer texto.
 *
 * Es una garantía que se rompe con una línea, en cualquier archivo, sin que se
 * note: un `import AgoraRTC from "agora-rtc-sdk-ng"` compila, pasa el lint y
 * anda perfecto — sólo que la pantalla de mensajes empieza a pesar un mega más.
 * No hay forma de detectarlo leyendo el diff de un archivo; sí hay forma de
 * detectarlo leyendo TODOS, y eso es este test.
 *
 * Se lee el código fuente en vez de inspeccionar el bundle a propósito: mirar el
 * output de `next build` obligaría a construir la app entera para correr un
 * test, y el `import type` —que es lo único permitido— desaparece en la
 * compilación, así que la afirmación se puede hacer antes.
 */

const RAIZ = fileURLToPath(new URL("../..", import.meta.url));
const PAQUETE = "agora-rtc-sdk-ng";

/**
 * `import ... from "agora-rtc-sdk-ng"` al principio de una línea.
 *
 * La cláusula se limita a identificadores, llaves y comas —ni comillas ni punto
 * y coma— para que el cuantificador perezoso no pueda atravesar los imports
 * anteriores del archivo y terminar acusando a un `import { useEffect } from
 * "react"` de traer el SDK.
 */
const IMPORT_ESTATICO = new RegExp(
  String.raw`^import\s+((?:type\s+)?[\w*{}\s,]*?)\s*from\s+["']` + PAQUETE + String.raw`["']`,
  "gm",
);

function archivosDeCodigo(directorio: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(directorio)) {
    if (entrada === "node_modules" || entrada.startsWith(".")) continue;
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...archivosDeCodigo(ruta));
    } else if (/\.(ts|tsx)$/.test(entrada)) {
      salida.push(ruta);
    }
  }
  return salida;
}

function relativo(ruta: string): string {
  return ruta.slice(RAIZ.length).replace(/\\/g, "/");
}

describe("carga perezosa del SDK de Agora", () => {
  it("ningún archivo de src/ lo importa de forma estática — sólo `import type`", () => {
    const culpables: string[] = [];

    for (const ruta of archivosDeCodigo(RAIZ)) {
      const codigo = readFileSync(ruta, "utf8");
      if (!codigo.includes(PAQUETE)) continue;

      for (const coincidencia of codigo.matchAll(IMPORT_ESTATICO)) {
        const clausula = (coincidencia[1] ?? "").trim();
        if (!clausula.startsWith("type")) {
          culpables.push(`${relativo(ruta)} → import ${clausula}`);
        }
      }
    }

    expect(culpables).toEqual([]);
  });

  it("existe exactamente un `import()` dinámico, y vive en el cargador", () => {
    const conDinamico = archivosDeCodigo(RAIZ).filter((ruta) =>
      readFileSync(ruta, "utf8").includes(`import("${PAQUETE}")`),
    );

    expect(conDinamico.map(relativo)).toEqual(["lib/calls/sdk.ts"]);
  });
});
