import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PRIVACY_BLOCKS,
  PRIVACY_DEFAULTS,
  PRIVACY_KEYS,
  PRIVACY_LEVELS,
  isDefaultPrivacy,
  isPrivacyLevel,
  normalizePrivacy,
  privacyAllows,
  type PrivacyKey,
  type PrivacyLevel,
} from "./privacy";

/**
 * CONTRATO — el modelo de privacidad de la app dice lo MISMO que la base.
 *
 * La privacidad de verdad la aplica `public.profile_card()` dentro de Postgres
 * (migración 0063). Este módulo es su espejo en TypeScript, y existe para dos
 * cosas: dibujar la pantalla de ajustes y previsualizar el efecto sin ir al
 * servidor.
 *
 * El riesgo es que los dos se separen. Y no se separan de forma ruidosa: se
 * separan callados, y el síntoma es una pantalla que dice "público" mientras el
 * servidor sigue devolviendo NULL — o sea alguien que cree que compartió algo
 * que en realidad no ve nadie. Por eso varios de estos tests LEEN LA MIGRACIÓN y
 * comparan contra ella, en vez de repetir a mano lo que ahí dice.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0063_privacidad_del_perfil.sql", import.meta.url)),
  "utf8",
);

describe("los defaults son EXACTAMENTE los de la base", () => {
  it("la migración existe y se pudo leer (si no, el test es decorativo)", () => {
    expect(MIGRATION).toContain("create table if not exists public.profile_privacy");
  });

  /**
   * `create table` declara un `default` por columna, y
   * `app.profile_privacy_defaults()` declara los mismos valores para cuando NO
   * hay fila. Los dos tienen que coincidir con `PRIVACY_DEFAULTS`.
   */
  it.each(PRIVACY_KEYS)("%s tiene el mismo default que la columna", (key) => {
    const declared = new RegExp(`${key}\\s+text not null default '(\\w+)'`).exec(MIGRATION);
    expect(declared, `no se encontró el default de ${key} en 0063`).not.toBeNull();
    expect(PRIVACY_DEFAULTS[key]).toBe(declared?.[1]);
  });

  it("los defaults son conservadores: apellido y edad, sólo para uno mismo", () => {
    // No es una preferencia estética. Un default abierto expone a quien nunca
    // abrió esta pantalla, que es la mayoría de la gente.
    expect(PRIVACY_DEFAULTS.show_last_name).toBe("privado");
    expect(PRIVACY_DEFAULTS.show_birthdate).toBe("privado");
    expect(PRIVACY_DEFAULTS.show_location).toBe("seguidores");
    expect(PRIVACY_DEFAULTS.show_followers).toBe("seguidores");
  });

  it("las 8 columnas de la tabla están todas en PRIVACY_KEYS", () => {
    const inMigration = [...MIGRATION.matchAll(/^\s{2}(show_\w+)\s+text not null/gm)].map(
      (m) => m[1],
    );
    expect(inMigration.length).toBe(8);
    expect([...inMigration].sort()).toEqual([...PRIVACY_KEYS].sort());
  });

  it("los tres niveles son los del CHECK de la base", () => {
    expect([...PRIVACY_LEVELS]).toEqual(["publico", "seguidores", "privado"]);
    for (const level of PRIVACY_LEVELS) {
      expect(MIGRATION).toContain(`'${level}'`);
    }
  });
});

/**
 * LA MATRIZ, NIVEL POR NIVEL.
 *
 * Espejo de `app.privacy_allows(nivel, es_dueño, es_seguidor)`:
 *   · el dueño se ve entero SIEMPRE, sin importar el nivel;
 *   · 'publico' pasa para cualquiera, con o sin cuenta;
 *   · 'seguidores' pasa sólo para quien sigue;
 *   · 'privado' —y cualquier valor raro— no pasa para nadie más (fail closed).
 */
describe("privacyAllows — la matriz completa", () => {
  const CASES: Array<[PrivacyLevel, boolean, boolean, boolean]> = [
    // nivel,        dueño, seguidor, ¿se ve?
    ["publico", false, false, true],
    ["publico", false, true, true],
    ["publico", true, true, true],
    ["seguidores", false, false, false],
    ["seguidores", false, true, true],
    ["seguidores", true, false, true],
    ["privado", false, false, false],
    ["privado", false, true, false],
    ["privado", true, false, true],
  ];

  it.each(CASES)(
    "nivel %s · dueño=%s · seguidor=%s → %s",
    (level, owner, follower, expected) => {
      expect(privacyAllows(level, owner, follower)).toBe(expected);
    },
  );

  it("el dueño se ve entero en los TRES niveles", () => {
    for (const level of PRIVACY_LEVELS) {
      expect(privacyAllows(level, true, false)).toBe(true);
    }
  });

  it("sin sesión, sólo 'publico' pasa", () => {
    // Quien mira sin cuenta no es dueño ni seguidor de nadie.
    expect(privacyAllows("publico", false, false)).toBe(true);
    expect(privacyAllows("seguidores", false, false)).toBe(false);
    expect(privacyAllows("privado", false, false)).toBe(false);
  });
});

describe("normalizePrivacy — fail closed", () => {
  it("sin fila, rigen los defaults (la ausencia SIGNIFICA los defaults)", () => {
    // Es la decisión de 0063: no se siembra una fila por registro, para que
    // nadie quede expuesto por una fila que no se llegó a crear.
    expect(normalizePrivacy(null)).toEqual(PRIVACY_DEFAULTS);
    expect(normalizePrivacy(undefined)).toEqual(PRIVACY_DEFAULTS);
    expect(normalizePrivacy({})).toEqual(PRIVACY_DEFAULTS);
  });

  /**
   * Un valor inesperado NO se corrige hacia arriba. Es el mismo criterio que el
   * `else false` de `app.privacy_allows()`: ante la duda, se cierra.
   */
  it.each([
    "PUBLICO",
    "public",
    "amigos",
    "",
    "true",
  ])("un valor raro (%j) cae al default, nunca a 'publico'", (raw) => {
    const result = normalizePrivacy({ show_last_name: raw });
    expect(result.show_last_name).toBe(PRIVACY_DEFAULTS.show_last_name);
    expect(result.show_last_name).toBe("privado");
  });

  it("un valor raro en un bloque que POR DEFAULT es público no lo abre más", () => {
    // `show_bio` es 'publico' por default, así que caer al default no lo abre:
    // lo deja donde ya estaba. Lo importante es que no se INVENTE un nivel.
    const result = normalizePrivacy({ show_bio: "solo-mis-amigos" });
    expect(result.show_bio).toBe(PRIVACY_DEFAULTS.show_bio);
  });

  it("respeta los valores válidos y completa el resto", () => {
    const result = normalizePrivacy({ show_bio: "privado", show_location: "publico" });
    expect(result.show_bio).toBe("privado");
    expect(result.show_location).toBe("publico");
    expect(result.show_last_name).toBe(PRIVACY_DEFAULTS.show_last_name);
  });

  it("tipos no-string tampoco pasan", () => {
    const result = normalizePrivacy({
      show_bio: null,
      show_location: 1,
      show_posts: true,
    } as Partial<Record<PrivacyKey, unknown>>);
    expect(result).toEqual(PRIVACY_DEFAULTS);
  });
});

describe("isPrivacyLevel", () => {
  it("acepta los tres y nada más", () => {
    for (const level of PRIVACY_LEVELS) expect(isPrivacyLevel(level)).toBe(true);
    for (const bad of ["publica", "PRIVADO", 1, null, undefined, {}]) {
      expect(isPrivacyLevel(bad)).toBe(false);
    }
  });
});

describe("isDefaultPrivacy", () => {
  it("reconoce la configuración recomendada", () => {
    expect(isDefaultPrivacy(PRIVACY_DEFAULTS)).toBe(true);
    expect(isDefaultPrivacy({ ...PRIVACY_DEFAULTS, show_bio: "privado" })).toBe(false);
  });
});

/**
 * LA PANTALLA. Estos tests no miran cómo se ve: miran que la pantalla pueda
 * EXPLICAR cada opción. El punto del diseño es que se lea el efecto ("Nadie ve
 * tu apellido") y no la etiqueta ("Privado"); un bloque sin frase para alguno de
 * los tres niveles rompe eso en silencio, y sólo se nota tocando esa opción.
 */
describe("los 8 bloques de la pantalla", () => {
  it("hay uno por columna, sin faltantes ni repetidos", () => {
    expect(PRIVACY_BLOCKS.length).toBe(PRIVACY_KEYS.length);
    expect(PRIVACY_BLOCKS.map((b) => b.key).sort()).toEqual([...PRIVACY_KEYS].sort());
  });

  it.each(PRIVACY_BLOCKS)("«$title» explica el efecto de los tres niveles", (block) => {
    for (const level of PRIVACY_LEVELS) {
      expect(block.effect[level], `${block.key} / ${level}`).toBeTruthy();
      expect(block.effect[level].length).toBeGreaterThan(10);
    }
  });

  it.each(PRIVACY_BLOCKS)("«$title» no le habla a la persona de nombres de columna", (block) => {
    const text = [block.title, block.detail, ...Object.values(block.effect)].join(" ");
    expect(text).not.toContain("show_");
    expect(text.toLowerCase()).not.toContain("null");
  });

  /**
   * Las dos advertencias que NO dependen del nivel elegido, y que son
   * exactamente las que alguien asumiría mal:
   *   · la fecha de nacimiento nunca sale completa, ni en "Cualquiera";
   *   · cerrar las publicaciones del PERFIL no las saca del feed.
   * Enterarse de esto después es lo que rompe la confianza.
   */
  it("la edad avisa que la fecha exacta nunca se muestra", () => {
    const block = PRIVACY_BLOCKS.find((b) => b.key === "show_birthdate");
    expect(block?.caveat).toBeTruthy();
    expect(block?.caveat?.toLowerCase()).toContain("nunca");
  });

  it("las publicaciones avisan que el feed no se ve afectado", () => {
    const block = PRIVACY_BLOCKS.find((b) => b.key === "show_posts");
    expect(block?.caveat?.toLowerCase()).toContain("feed");
  });
});
