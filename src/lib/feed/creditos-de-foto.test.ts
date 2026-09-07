import { describe, expect, it, vi } from "vitest";
import {
  CREDITO_COPY,
  MAX_PHOTO_CREDIT,
  PHOTO_RIGHTS,
  creditoDesdeDeclaracion,
  fetchPhotoCredits,
  lineaDeCredito,
  normalizarCredito,
} from "./creditos-de-foto";
import { LICENSE_KINDS } from "@/lib/integrity/declarations";

/**
 * DERECHOS Y FUENTE DE LA FOTO (0146) — la lógica pura.
 *
 * Lo que se prueba acá no es "el mapeo anda": es que la traducción del
 * vocabulario de moderación al público NUNCA INVENTE UNA AFIRMACIÓN que la
 * persona no hizo. Ése es el único error de este módulo que importa de verdad —
 * el resto se ve en pantalla, y esto no: queda escrito debajo de una foto como
 * si lo hubiera dicho su autor.
 */

describe("creditoDesdeDeclaracion — no declarar es una respuesta", () => {
  it("sin licencia ni fuente no hay crédito", () => {
    expect(
      creditoDesdeDeclaracion({
        licenseKind: "desconocido",
        licenseStatement: "",
        licenseUrl: "",
      }),
    ).toBeNull();
  });

  it("'prefiero no aclararlo' con los campos en blanco tampoco inventa nada", () => {
    // Es EL caso peligroso: la persona abrió el bloque, lo miró y no dijo nada.
    // Cualquier crédito acá sería una afirmación puesta en su boca.
    expect(creditoDesdeDeclaracion({ licenseKind: "desconocido" })).toBeNull();
  });

  it("espacios en blanco no cuentan como fuente", () => {
    expect(
      creditoDesdeDeclaracion({ licenseKind: "desconocido", licenseStatement: "   " }),
    ).toBeNull();
  });
});

describe("creditoDesdeDeclaracion — la traducción del vocabulario", () => {
  it("'es material mío' se declara propia", () => {
    expect(creditoDesdeDeclaracion({ licenseKind: "propio" })).toEqual({
      rights: "propia",
      credit: null,
    });
  });

  it("'tengo permiso' viaja tal cual", () => {
    expect(creditoDesdeDeclaracion({ licenseKind: "con_permiso" })).toEqual({
      rights: "con_permiso",
      credit: null,
    });
  });

  it.each(["licencia_comercial", "creative_commons", "dominio_publico"])(
    "%s colapsa en 'libre' (la distinción es para moderación, no para la tarjeta)",
    (licenseKind) => {
      expect(creditoDesdeDeclaracion({ licenseKind })).toMatchObject({ rights: "libre" });
    },
  );

  it("citar una fuente sin reclamar derechos es 'de otra fuente'", () => {
    // La inferencia MÁS conservadora que existe: dijo de dónde salió y no se
    // atribuyó nada. Es exactamente lo que significa "la compartí de otra
    // fuente", ni un gramo más.
    expect(
      creditoDesdeDeclaracion({
        licenseKind: "desconocido",
        licenseStatement: "El Tiempo",
      }),
    ).toEqual({ rights: "de_otra_fuente", credit: "El Tiempo" });
  });

  it("una licencia que este módulo no conoce NUNCA se lee como propia", () => {
    // El default del switch es la red: si mañana la 0061 suma un valor y nadie
    // toca este archivo, lo peor que pasa es que se pierda el matiz — jamás que
    // alguien aparezca reclamando una foto que no reclamó.
    const credito = creditoDesdeDeclaracion({
      licenseKind: "licencia_del_futuro",
      licenseStatement: "Revista Semana",
    });
    expect(credito?.rights).toBe("de_otra_fuente");
    expect(creditoDesdeDeclaracion({ licenseKind: "licencia_del_futuro" })).toBeNull();
  });

  it("todo `license_kind` de la 0061 tiene traducción definida", () => {
    // Ancla contra la divergencia silenciosa entre los dos vocabularios: si la
    // 0061 suma un valor, este test no falla —el default lo cubre— pero deja
    // dicho cuál quedó cayendo al caso conservador.
    for (const kind of LICENSE_KINDS) {
      const credito = creditoDesdeDeclaracion({ licenseKind: kind, licenseStatement: "x" });
      expect(PHOTO_RIGHTS).toContain(credito?.rights);
    }
  });
});

describe("creditoDesdeDeclaracion — qué se elige como fuente", () => {
  it("la aclaración escrita le gana al link", () => {
    expect(
      creditoDesdeDeclaracion({
        licenseKind: "con_permiso",
        licenseStatement: "me las pasó el fotógrafo del local",
        licenseUrl: "https://ejemplo.com/foto",
      })?.credit,
    ).toBe("me las pasó el fotógrafo del local");
  });

  it("sin aclaración, el link es la fuente", () => {
    expect(
      creditoDesdeDeclaracion({
        licenseKind: "libre",
        licenseUrl: "https://unsplash.com/x",
      })?.credit,
    ).toBe("https://unsplash.com/x");
  });
});

describe("normalizarCredito — el borde del servidor", () => {
  it("acepta los cuatro valores del catálogo", () => {
    for (const rights of PHOTO_RIGHTS) {
      expect(normalizarCredito(rights, null)).toEqual({ rights, credit: null });
    }
  });

  it("un origen fuera del catálogo degrada a 'no declaró', no a un error", () => {
    // Degradar y no lanzar: un crédito malformado no puede tumbar la
    // publicación entera. Mismo criterio que `normalizeDeclaration`.
    expect(normalizarCredito("propia_pero_no", "x")).toBeNull();
    expect(normalizarCredito(undefined, "x")).toBeNull();
    expect(normalizarCredito(42, "x")).toBeNull();
  });

  it("una fuente sin origen no se sostiene sola", () => {
    // Espeja el CHECK `posts_photo_credit_needs_rights` de la 0146.
    expect(normalizarCredito(null, "El Tiempo")).toBeNull();
  });

  it("la cadena vacía se guarda como null, no como dato", () => {
    expect(normalizarCredito("propia", "   ")).toEqual({ rights: "propia", credit: null });
  });

  it("recorta al tope del CHECK en vez de rebotar el insert", () => {
    const largo = "a".repeat(MAX_PHOTO_CREDIT + 50);
    const credito = normalizarCredito("libre", largo);
    expect(credito?.credit).toHaveLength(MAX_PHOTO_CREDIT);
  });
});

describe("lineaDeCredito — lo que se lee debajo de la foto", () => {
  it("sin fuente, sólo el origen", () => {
    expect(lineaDeCredito({ rights: "propia", credit: null })).toBe("Foto propia");
  });

  it("con fuente, origen + fuente", () => {
    expect(lineaDeCredito({ rights: "libre", credit: "Unsplash" })).toBe(
      "Foto de uso libre · Unsplash",
    );
  });

  it("los cuatro orígenes tienen copy y ninguno suena a jerga legal", () => {
    for (const rights of PHOTO_RIGHTS) {
      const texto = CREDITO_COPY.rights[rights];
      expect(texto).toMatch(/^Foto /);
      expect(texto.length).toBeLessThan(40);
    }
  });

  it("el disclaimer dice que la plataforma NO verificó", () => {
    // No es una preferencia de redacción: es el criterio legal de la 0061 y del
    // verificador. Una declaración del usuario jamás puede leerse como un sello
    // de la plataforma.
    expect(CREDITO_COPY.disclaimer).toMatch(/no lo verific/i);
  });
});

/* ------------------------------ La lectura -------------------------------- */

function supabaseQue(resultado: { data?: unknown; error?: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    not: vi.fn(() => Promise.resolve({ data: null, error: null, ...resultado })),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: vi.fn(() => builder) } as any;
}

describe("fetchPhotoCredits — nunca rompe el feed", () => {
  it("sin la 0146 aplicada devuelve un mapa vacío y no lanza", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = supabaseQue({ error: { code: "42703" } });

    await expect(fetchPhotoCredits(supabase, ["p1"])).resolves.toEqual(new Map());
  });

  it("sin ids no sale a preguntar", async () => {
    const supabase = supabaseQue({ data: [] });
    await fetchPhotoCredits(supabase, []);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("mapea por id de post y descarta filas con un origen que no existe", async () => {
    const supabase = supabaseQue({
      data: [
        { id: "p1", photo_rights: "libre", photo_credit: "Unsplash" },
        { id: "p2", photo_rights: "inventado", photo_credit: "x" },
      ],
    });

    const mapa = await fetchPhotoCredits(supabase, ["p1", "p2"]);

    expect(mapa.get("p1")).toEqual({ rights: "libre", credit: "Unsplash" });
    expect(mapa.has("p2")).toBe(false);
  });
});
