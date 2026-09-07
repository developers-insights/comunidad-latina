import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_HILOS_ESCUCHADOS,
  PREFIJO_DIRECTO,
  PREFIJO_GRUPO,
  THROTTLE_MS,
  VIGENCIA_MS,
  esAvisoDeEscritura,
  esTopicoDeEscritura,
  resolverQuienEscribe,
  topicoDeDirecto,
  topicoDeGrupo,
} from "./escribiendo";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRACION_0148 = readFileSync(
  resolve(HERE, "../../../supabase/migrations/0148_esta_escribiendo_en_vivo.sql"),
  "utf8",
);

const CONVERSACION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const GRUPO = "11111111-2222-4333-8444-555555555555";
const ANA = "99999999-9999-4999-8999-999999999999";
const BETO = "88888888-8888-4888-8888-888888888888";

/**
 * ═══ POR QUÉ ESTE TEST LEE EL SQL ═══════════════════════════════════════════
 * Los prefijos de los tópicos viven DOS veces: en `escribiendo.ts` y adentro de
 * las cuatro policies de la 0148. Cuando se separan, el modo de falla es MUDO:
 * el canal conecta, la policy no matchea, y desde la app se ve idéntico a
 * "nadie está escribiendo". No hay error, no hay log, no hay nada.
 *
 * Mismo patrón que `adjuntos.test.ts` con el bucket de la 0140.
 */
describe("los prefijos no se separan de la migración", () => {
  it("la 0148 autoriza exactamente los dos prefijos que arma el cliente", () => {
    expect(MIGRACION_0148).toContain(`'${PREFIJO_DIRECTO}'`);
    expect(MIGRACION_0148).toContain(`'${PREFIJO_GRUPO}'`);
  });

  it("hay una policy de recibir y una de emitir para cada uno de los dos hilos", () => {
    for (const policy of [
      "escribiendo_directo_recibir",
      "escribiendo_directo_emitir",
      "escribiendo_grupo_recibir",
      "escribiendo_grupo_emitir",
    ]) {
      expect(MIGRACION_0148).toContain(`create policy ${policy}`);
    }
  });

  /**
   * Un `for insert ... using (...)` es SQL inválido —una policy de INSERT se
   * escribe con `with check`— y aparece así en algunos ejemplos publicados de
   * Supabase. Si se colara, la migración no aplica.
   */
  it("las policies de emitir usan with check y no using", () => {
    const insertados = MIGRACION_0148.split("create policy").filter((bloque) =>
      bloque.includes("for insert"),
    );
    expect(insertados).toHaveLength(2);
    for (const bloque of insertados) {
      const cuerpo = bloque.slice(0, bloque.indexOf(");"));
      expect(cuerpo).toContain("with check");
      expect(cuerpo).not.toContain("using (");
    }
  });

  /**
   * El cast a uuid tiene que estar adentro de un CASE: suelto, un tópico sin
   * uuid LANZA, y una excepción adentro de una policy rompe la consulta en vez
   * de negarla prolijamente.
   */
  it("el uuid del tópico se castea adentro de un case", () => {
    const funcion = MIGRACION_0148.slice(
      MIGRACION_0148.indexOf("create or replace function app.hilo_de_topico"),
    );
    const cuerpo = funcion.slice(0, funcion.indexOf("$$;"));
    expect(cuerpo).toContain("case");
    expect(cuerpo).toContain("::uuid");
    expect(cuerpo.indexOf("case")).toBeLessThan(cuerpo.indexOf("::uuid"));
  });
});

describe("los tópicos", () => {
  it("se arman con el prefijo y el id", () => {
    expect(topicoDeDirecto(CONVERSACION)).toBe(`${PREFIJO_DIRECTO}:${CONVERSACION}`);
    expect(topicoDeGrupo(GRUPO)).toBe(`${PREFIJO_GRUPO}:${GRUPO}`);
  });

  it("acepta los que arma la app", () => {
    expect(esTopicoDeEscritura(topicoDeDirecto(CONVERSACION))).toBe(true);
    expect(esTopicoDeEscritura(topicoDeGrupo(GRUPO))).toBe(true);
  });

  it("rechaza cualquier otra cosa antes de abrir un canal", () => {
    for (const invalido of [
      "",
      "escribiendo-directo:",
      "escribiendo-directo:no-es-un-uuid",
      `escribiendo-directo:${CONVERSACION}x`,
      `llamadas:${CONVERSACION}`,
      `escribiendo-otro:${CONVERSACION}`,
      // El id de un grupo por el canal de un directo tiene que seguir siendo
      // válido como FORMA: quien decide si corresponde es la policy, no esto.
      null,
      undefined,
      42,
      { topico: `escribiendo-grupo:${GRUPO}` },
    ]) {
      expect(esTopicoDeEscritura(invalido)).toBe(false);
    }
  });
});

describe("el aviso que llega por el canal", () => {
  it("acepta la forma esperada", () => {
    expect(esAvisoDeEscritura({ de: ANA, activo: true })).toBe(true);
    expect(esAvisoDeEscritura({ de: ANA, activo: false })).toBe(true);
  });

  it("rechaza lo que no la tiene — el payload lo escribe otro navegador", () => {
    for (const basura of [
      null,
      undefined,
      "escribiendo",
      {},
      { de: ANA },
      { activo: true },
      { de: "", activo: true },
      { de: 7, activo: true },
      { de: ANA, activo: "si" },
    ]) {
      expect(esAvisoDeEscritura(basura)).toBe(false);
    }
  });
});

describe("de ids a nombres", () => {
  const nombres = new Map([
    [ANA, "Ana"],
    [BETO, "Beto"],
  ]);

  it("resuelve contra el mapa del servidor y conserva el orden de llegada", () => {
    expect(resolverQuienEscribe([BETO, ANA], nombres, "Alguien")).toEqual(["Beto", "Ana"]);
  });

  /**
   * LA GARANTÍA QUE IMPORTA: el nombre NUNCA sale del aviso. Alguien del grupo
   * que todavía no habló no está en el mapa, y su cartel dice el genérico — no
   * el nombre que su navegador quisiera mandar.
   */
  it("un id desconocido cae en el genérico", () => {
    expect(resolverQuienEscribe(["fantasma"], nombres, "Alguien")).toEqual(["Alguien"]);
  });
});

describe("los tiempos", () => {
  /**
   * Si fueran parecidos, un request lento apagaría el cartel de alguien que
   * sigue escribiendo y lo volvería a prender un instante después: un parpadeo
   * peor que no mostrarlo.
   */
  it("el cartel vive bastante más de lo que tarda la próxima señal", () => {
    expect(VIGENCIA_MS).toBeGreaterThanOrEqual(THROTTLE_MS * 2);
  });

  it("la bandeja no abre un canal por fila sin techo", () => {
    expect(MAX_HILOS_ESCUCHADOS).toBeGreaterThan(0);
    expect(MAX_HILOS_ESCUCHADOS).toBeLessThanOrEqual(20);
  });
});
