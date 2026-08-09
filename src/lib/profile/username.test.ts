import { describe, expect, it } from "vitest";
import {
  isUsernameTakenError,
  isValidUsername,
  normalizeUsername,
  suggestUsername,
  usernameProblem,
} from "./username";

/**
 * El handle: espejo de lo que valida la base (0062).
 *
 * ── QUÉ CUIDA ESTE TEST ──────────────────────────────────────────────────────
 * Que la validación de la app sea IGUAL o MÁS ESTRICTA que la de la base, nunca
 * más laxa. Si acá pasara algo que el CHECK `profiles_username_format` rechaza,
 * la persona completaría el alta entera y el insert reventaría al final con un
 * error de Postgres — el peor momento posible para enterarse.
 *
 * El patrón de la base, textual:
 *   `^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$`
 * y ANTES el trigger `app.normalize_profile_username()` hace lower + btrim, y
 * convierte el string vacío en NULL.
 */

describe("normalizeUsername — el trigger de la base, en TypeScript", () => {
  it("pasa a minúsculas y recorta, igual que el trigger", () => {
    expect(normalizeUsername("  Rosa.Martinez  ")).toBe("rosa.martinez");
  });

  it("el string vacío es NULL, no es un handle vacío", () => {
    // Es literal lo que hace el trigger: `if new.username = '' then null`. Sin
    // esto, "sin username" tendría dos valores distintos y el índice único
    // parcial (`where username is not null`) dejaría pasar varios "" por tenant.
    expect(normalizeUsername("")).toBeNull();
    expect(normalizeUsername("   ")).toBeNull();
    expect(normalizeUsername(null)).toBeNull();
    expect(normalizeUsername(undefined)).toBeNull();
  });
});

describe("usernameProblem — el CHECK de la base, en TypeScript", () => {
  it.each([
    ["rosa", "un handle corriente"],
    ["rosa.martinez", "con punto"],
    ["rosa_martinez", "con guion bajo"],
    ["r2d2", "con números"],
    ["abc", "el mínimo de 3"],
    ["a".repeat(30), "el máximo de 30"],
  ])("acepta %s (%s)", (value) => {
    expect(usernameProblem(value)).toBeNull();
    expect(isValidUsername(value)).toBe(true);
  });

  it.each([
    ["", "vacio"],
    ["ab", "corto"],
    ["a".repeat(31), "largo"],
    [".rosa", "bordes"],
    ["rosa.", "bordes"],
    ["_rosa", "bordes"],
    ["rosa_", "bordes"],
    ["rosa martinez", "formato"],
    ["rosa-martinez", "formato"],
    ["rosa@martinez", "formato"],
    ["rosá", "formato"],
    ["росса", "formato"],
    ["rosa/../admin", "formato"],
  ] as const)("rechaza %j con el problema %s", (value, problem) => {
    expect(usernameProblem(value)).toBe(problem);
  });

  it("valida DESPUÉS de normalizar, no antes", () => {
    // "ROSA" en mayúsculas es válido: el trigger lo baja a minúsculas antes de
    // que el CHECK lo mire. Si acá se validara el texto crudo, se rechazaría un
    // handle que la base habría aceptado sin problema.
    expect(usernameProblem("ROSA.Martinez")).toBeNull();
    expect(usernameProblem("  rosa  ")).toBeNull();
  });
});

describe("isUsernameTakenError — distinguir el 23505 del handle", () => {
  it("reconoce el choque contra el índice del handle", () => {
    expect(
      isUsernameTakenError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "profiles_username_tenant_uniq"',
        details: "Key (tenant_id, username)=(t1, rosa) already exists.",
      }),
    ).toBe(true);
  });

  /**
   * EL CASO QUE JUSTIFICA LA FUNCIÓN. Mirar sólo `code === "23505"` haría que un
   * choque de clave primaria se le contara a la persona como "elegí otro nombre
   * de usuario" — un mensaje que no tiene ninguna relación con lo que pasó y que
   * la manda a probar handles nuevos para siempre.
   */
  it("NO confunde un choque de clave primaria con un handle tomado", () => {
    expect(
      isUsernameTakenError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "profiles_pkey"',
        details: "Key (id)=(user-1) already exists.",
      }),
    ).toBe(false);
  });

  it("ignora errores que no son de unicidad", () => {
    expect(isUsernameTakenError({ code: "23514", message: "check violation" })).toBe(false);
    expect(isUsernameTakenError(null)).toBe(false);
  });
});

describe("suggestUsername", () => {
  it("saca acentos y arma un handle válido", () => {
    expect(suggestUsername("Rosa Martínez")).toBe("rosa.martinez");
    expect(isValidUsername(suggestUsername("Rosa Martínez"))).toBe(true);
  });

  it("nunca deja punto al principio ni al final", () => {
    expect(suggestUsername("  Rosa  ")).toBe("rosa");
    expect(suggestUsername("¡Rosa!")).toBe("rosa");
  });

  it("respeta el tope de 30 caracteres", () => {
    const suggestion = suggestUsername("Maria del Carmen Fernandez de la Torre");
    expect(suggestion.length).toBeLessThanOrEqual(30);
    expect(isValidUsername(suggestion)).toBe(true);
  });

  it("devuelve vacío cuando no queda nada usable, en vez de un handle raro", () => {
    // Un campo vacío es honesto: dice "elegilo vos". Un "a.1" inventado se
    // queda para siempre porque nadie lo revisa.
    expect(suggestUsername("🎉🎉🎉")).toBe("");
    expect(suggestUsername("Jo")).toBe("");
  });

  it("todo lo que sugiere, la base lo acepta", () => {
    const names = [
      "Rosa Martínez",
      "José Ramón Peña",
      "Ana-María O'Brien",
      "Jean-Baptiste Toussaint",
      "李小龍 Bruce",
      "Nicolás   Gómez  ",
    ];
    for (const name of names) {
      const suggestion = suggestUsername(name);
      if (suggestion === "") continue;
      expect(isValidUsername(suggestion), `${name} → ${suggestion}`).toBe(true);
    }
  });
});
