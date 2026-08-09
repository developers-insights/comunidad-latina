import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProfileCard, fullName } from "./profile-card";
import { PRIVACY_DEFAULTS, privacyAllows } from "@/lib/profile/privacy";

/**
 * EL PERFIL PÚBLICO SE LEE POR `profile_card()`, Y NO DE OTRA FORMA.
 *
 * ── EL AGUJERO QUE ESTE TEST CUIDA ───────────────────────────────────────────
 * `bio` y `country_origin` viven en `public.profiles`, cuya policy de SELECT es
 * `using(true)`. RLS filtra FILAS, no columnas: cualquier consulta directa a esa
 * tabla los devuelve sin pasar por la matriz de privacidad, así que la persona
 * podía poner su presentación en "solo yo" y la pantalla la publicaba igual. La
 * migración 0063 lo dejó anotado en el comentario de `show_bio` como el hueco
 * pendiente de cerrar en la app.
 *
 * Se cierra pasando TODA lectura de perfil por `public.profile_card()`, que es
 * SECURITY DEFINER y aplica la matriz adentro de la base. Lo que la
 * configuración no permite vuelve NULL desde el servidor y no viaja al cliente.
 *
 * Este test tiene dos mitades:
 *   1. Un test de CONTRATO sobre el código: ninguna pantalla de perfil vuelve a
 *      leer `bio` o `country_origin` de `profiles`.
 *   2. Tests de comportamiento del wrapper con la RPC mockeada.
 */

/* ───────────────────────── 1. El contrato del código ───────────────────────── */

const SRC_DIR = fileURLToPath(new URL("../../..", import.meta.url));

function collectFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) found.push(full);
  }
  return found;
}

/** Las pantallas de perfil: donde se muestra la ficha de una persona. */
const profileScreens = collectFiles(join(SRC_DIR, "app", "(app)", "perfil"))
  .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
  .map((file) => ({ file: file.slice(SRC_DIR.length), source: readFileSync(file, "utf8") }));

describe("contrato: el perfil no se lee directo de `profiles`", () => {
  it("hay pantallas que revisar (si no, el test se volvió decorativo)", () => {
    expect(profileScreens.length).toBeGreaterThan(0);
  });

  /**
   * `select("*")` sobre `profiles` era el bloqueo estructural: mientras
   * existiera, no se podía cerrar la tabla por GRANT de columna para
   * `authenticated` (revocar una columna tira 42501 sobre la consulta entera),
   * así que TODA columna nueva nacía legible por cualquier usuario con sesión.
   * Lo dejaron escrito 0058, 0062 y 0067, cada una esperando a que esta línea
   * desapareciera.
   */
  it('ninguna pantalla de perfil hace select("*") sobre profiles', () => {
    const offenders = profileScreens
      .filter(({ source }) => /from\("profiles"\)\s*\.\s*select\(\s*["'`]\*/.test(source))
      .map(({ file }) => file);
    expect(
      offenders,
      'un select("*") sobre `profiles` publica cada columna nueva y bloquea los grants por columna',
    ).toEqual([]);
  });

  it("ninguna pantalla de perfil lee bio ni country_origin de `profiles`", () => {
    const offenders: string[] = [];
    for (const { file, source } of profileScreens) {
      // Cada `.from("profiles").select("…")` de la pantalla, con su lista.
      const selects = [...source.matchAll(/from\("profiles"\)[\s\S]{0,80}?\.select\(\s*"([^"]*)"/g)];
      for (const [, columns] of selects) {
        if (/\bbio\b/.test(columns) || /\bcountry_origin\b/.test(columns)) {
          offenders.push(`${file}: select("${columns}")`);
        }
      }
    }
    expect(
      offenders,
      "bio y country_origin sólo salen por profile_card(): leerlos de `profiles` saltea la matriz de privacidad",
    ).toEqual([]);
  });
});

/* ────────────────────── 2. El comportamiento del wrapper ────────────────────── */

const rpc = vi.fn();
const supabase = { rpc } as unknown as Parameters<typeof fetchProfileCard>[0];

/** Una fila como la que devuelve `profile_card()` para el DUEÑO (ve todo). */
function ownerRow() {
  return {
    id: "p1",
    display_name: "Rosa",
    username: "rosa.martinez",
    avatar_url: "https://cdn/a.webp",
    cover_url: "https://cdn/c.webp",
    identity_verified: true,
    created_at: "2026-03-01T02:00:00Z",
    bio: "Dominicana en Queens",
    country_origin: "DO",
    area_label: "Queens",
    last_name: "Martínez",
    age: 34,
    birthdate: "1992-04-10",
    country_residence: "US",
    city: "Nueva York",
    languages: ["es", "en"],
    can_see_followers: true,
    can_see_posts: true,
    viewer_is_owner: true,
    viewer_is_follower: true,
  };
}

/**
 * La MISMA fila tal como la devuelve la función para un extraño con los
 * DEFAULTS puestos: apellido y edad en 'privado', ubicación en 'seguidores'.
 * Los campos cerrados vuelven en null desde el servidor — no llegan y se
 * esconden, directamente no llegan.
 */
function strangerRow() {
  return {
    ...ownerRow(),
    last_name: null,
    age: null,
    birthdate: null,
    country_residence: null,
    city: null,
    can_see_followers: false,
    can_see_posts: true,
    viewer_is_owner: false,
    viewer_is_follower: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchProfileCard", () => {
  it("llama a la RPC correcta con el id del perfil", async () => {
    rpc.mockResolvedValue({ data: [ownerRow()], error: null });
    await fetchProfileCard(supabase, "p1");
    expect(rpc).toHaveBeenCalledWith("profile_card", { p_profile_id: "p1" });
  });

  it("el dueño recibe todo, incluida la fecha de nacimiento completa", async () => {
    rpc.mockResolvedValue({ data: [ownerRow()], error: null });
    const card = await fetchProfileCard(supabase, "p1");

    expect(card?.viewerIsOwner).toBe(true);
    expect(card?.lastName).toBe("Martínez");
    expect(card?.birthdate).toBe("1992-04-10");
    expect(card?.city).toBe("Nueva York");
    expect(card?.languages).toEqual(["es", "en"]);
  });

  it("un extraño NO recibe los campos que la privacidad cerró", async () => {
    rpc.mockResolvedValue({ data: [strangerRow()], error: null });
    const card = await fetchProfileCard(supabase, "p1");

    expect(card?.lastName).toBeNull();
    expect(card?.age).toBeNull();
    expect(card?.city).toBeNull();
    expect(card?.countryResidence).toBeNull();
    // La fecha exacta NUNCA sale, ni siquiera con el bloque en "publico".
    expect(card?.birthdate).toBeNull();
    expect(card?.canSeeFollowers).toBe(false);
  });

  it("cero filas = sin ficha (perfil inexistente o dado de baja)", async () => {
    // `profile_card` devuelve cero filas cuando el perfil no existe O cuando
    // `account_status = 'banned'`: la pantalla no tiene que acordarse de
    // chequear el estado de la cuenta.
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await fetchProfileCard(supabase, "p1")).toBeNull();
  });

  it("un error de la RPC devuelve null, nunca revienta la pantalla", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    expect(await fetchProfileCard(supabase, "p1")).toBeNull();
  });

  it("languages es siempre un array, aunque la fila traiga null", async () => {
    rpc.mockResolvedValue({ data: [{ ...strangerRow(), languages: null }], error: null });
    const card = await fetchProfileCard(supabase, "p1");
    expect(card?.languages).toEqual([]);
  });
});

describe("fullName", () => {
  it("suma el apellido cuando la privacidad lo dejó pasar", () => {
    expect(fullName({ displayName: "Rosa", lastName: "Martínez" })).toBe("Rosa Martínez");
  });

  /**
   * Sin apellido sale el nombre SOLO — nada de "Rosa M." ni "Rosa •••". Un
   * indicador de "acá hay un apellido oculto" también es información: confirma
   * que la persona cargó un apellido, que es parte de lo que eligió no contar.
   */
  it("sin apellido no deja ninguna marca de que hay algo oculto", () => {
    expect(fullName({ displayName: "Rosa", lastName: null })).toBe("Rosa");
    expect(fullName({ displayName: "Rosa", lastName: null })).not.toContain("•");
    expect(fullName({ displayName: "Rosa", lastName: null })).not.toContain(".");
  });
});

/**
 * ── LA MATRIZ APLICADA A CADA BLOQUE, CON LOS DEFAULTS ───────────────────────
 * Es el mismo cálculo que hace `profile_card` adentro de la base, corrido acá
 * sobre los defaults reales. Fija qué ve cada tipo de espectador de un perfil
 * que nunca tocó sus controles — que es la enorme mayoría de los perfiles.
 */
describe("qué ve cada quién con los defaults", () => {
  const VIEWERS = [
    { name: "un extraño", owner: false, follower: false },
    { name: "quien lo sigue", owner: false, follower: true },
    { name: "el dueño", owner: true, follower: true },
  ] as const;

  const EXPECTED: Record<string, [boolean, boolean, boolean]> = {
    // bloque              extraño, seguidor, dueño
    show_last_name: [false, false, true],
    show_birthdate: [false, false, true],
    show_location: [false, true, true],
    show_languages: [true, true, true],
    show_country_origin: [true, true, true],
    show_bio: [true, true, true],
    show_followers: [false, true, true],
    show_posts: [true, true, true],
  };

  for (const [key, expectations] of Object.entries(EXPECTED)) {
    VIEWERS.forEach((viewer, index) => {
      it(`${key}: ${viewer.name} → ${expectations[index] ? "lo ve" : "no lo ve"}`, () => {
        const level = PRIVACY_DEFAULTS[key as keyof typeof PRIVACY_DEFAULTS];
        expect(privacyAllows(level, viewer.owner, viewer.follower)).toBe(expectations[index]);
      });
    });
  }
});
