import { describe, expect, it } from "vitest";
import { MAX_PARTICIPANTES } from "@/lib/calls/tipos";
import { COPY } from "./copy";

/**
 * El copy de llamadas contra el tope REAL de la base.
 *
 * `app.tope_de_participantes_en_llamada()` corta en 10 (0139 §4.3). Si algún día
 * ese número cambia en la migración y no acá, la pantalla seguiría prometiendo
 * "Máximo 10 participantes" mientras la base acepta —o rechaza— otra cosa: la
 * clase de bug que nadie ve hasta que un usuario cuenta las caras.
 */
describe("copy del tope", () => {
  it("el máximo escrito en pantalla sale de la misma constante que usan las actions", () => {
    expect(COPY.agregar.tope).toContain(String(MAX_PARTICIPANTES));
    expect(COPY.fallos.llenaBody).toContain(String(MAX_PARTICIPANTES));
  });

  it("el cupo restante se dice en singular cuando es uno", () => {
    expect(COPY.agregar.cupo(1)).toBe("Podés sumar 1 persona más");
    expect(COPY.agregar.cupo(4)).toBe("Podés sumar 4 personas más");
  });

  it("el botón de añadir concuerda en número", () => {
    expect(COPY.agregar.boton(1)).toBe("Añadir 1");
    expect(COPY.agregar.boton(3)).toBe("Añadir 3");
  });

  it("el conteo de participantes concuerda en número", () => {
    expect(COPY.pantalla.participantes(1)).toBe("1 persona");
    expect(COPY.pantalla.participantes(6)).toBe("6 personas");
  });

  it("ninguna frase visible nombra al proveedor ni a la plomería", () => {
    // Que atrás haya Agora, un token o WebRTC es implementación. Si alguna de
    // esas palabras aparece en un texto de pantalla, es que se coló un mensaje
    // copiado de la documentación.
    //
    // Se recorren los VALORES y no `JSON.stringify(COPY)`: las CLAVES sí dicen
    // "token" (`errores.tokenTitle` es el nombre interno del caso) y eso no le
    // llega a nadie.
    for (const frase of frasesDe(COPY)) {
      const texto = frase.toLowerCase();
      expect(texto, frase).not.toContain("agora");
      expect(texto, frase).not.toContain("webrtc");
      expect(texto, frase).not.toContain("token");
      expect(texto, frase).not.toContain("canal");
    }
  });
});

/**
 * Todas las frases que un usuario puede llegar a leer: los strings del árbol,
 * más el resultado de las funciones de copy con un argumento cualquiera.
 */
function frasesDe(nodo: unknown): string[] {
  if (typeof nodo === "string") return [nodo];
  if (typeof nodo === "function") {
    const fn = nodo as (...args: unknown[]) => unknown;
    const salida = fn.length === 0 ? fn() : fn(2);
    return typeof salida === "string" ? [salida] : [];
  }
  if (nodo && typeof nodo === "object") {
    return Object.values(nodo as Record<string, unknown>).flatMap(frasesDe);
  }
  return [];
}
