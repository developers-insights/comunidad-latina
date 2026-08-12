import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOST_SCOPES,
  BOOST_SCOPE_COPY,
  DEFAULT_BOOST_SCOPE,
  boostIsOfferedOutside,
  boostReachesViewer,
  normalizeBoostScope,
  normalizeGeoLabel,
  parseBoostScope,
  readBoostScopeTarget,
  sameCountryLabel,
  sameZoneLabel,
  type BoostScopeTarget,
} from "./scope";

/**
 * El alcance del impulso vive en DOS lugares que tienen que decir lo mismo: el
 * CHECK de la migración 0092 y este módulo. Y adentro del módulo hay una sola
 * pregunta que decide plata: a quién le aplica el lugar pago. Estos tests son
 * lo que impide que las dos cosas se separen en silencio.
 */

const SQL_0092 = readFileSync(
  path.resolve(process.cwd(), "supabase", "migrations", "0092_alcance_geografico_del_boost.sql"),
  "utf8",
);

const local = (area: string | null): BoostScopeTarget => ({
  scope: "local",
  area,
  country: null,
});
const nacional = (country: string | null): BoostScopeTarget => ({
  scope: "nacional",
  area: null,
  country,
});
const global_: BoostScopeTarget = { scope: "global", area: null, country: null };

describe("el módulo espeja la migración 0092", () => {
  it("los alcances del código son exactamente los del CHECK", () => {
    const check = /check \(scope in \(([^)]*)\)\)/.exec(SQL_0092);
    expect(check, "no encontré el CHECK de scope en la 0092").not.toBeNull();
    const enSql = [...check![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(enSql)).toEqual(new Set(BOOST_SCOPES));
  });

  it("el default de lectura es el mismo default de la columna", () => {
    expect(SQL_0092).toContain(`add column if not exists scope text not null default '${DEFAULT_BOOST_SCOPE}'`);
  });

  it("cada alcance tiene copy propio — ninguno se muestra por su identificador", () => {
    for (const scope of BOOST_SCOPES) {
      expect(BOOST_SCOPE_COPY[scope].label.length).toBeGreaterThan(0);
      expect(BOOST_SCOPE_COPY[scope].hint.length).toBeGreaterThan(0);
      expect(BOOST_SCOPE_COPY[scope].reach.length).toBeGreaterThan(0);
      expect(BOOST_SCOPE_COPY[scope].label).not.toBe(scope);
    }
  });
});

describe("normalizeBoostScope — defensivo, nunca lanza", () => {
  it("acepta los tres alcances, con espacios y mayúsculas", () => {
    expect(normalizeBoostScope("local")).toBe("local");
    expect(normalizeBoostScope("  NACIONAL ")).toBe("nacional");
    expect(normalizeBoostScope("Global")).toBe("global");
  });

  it("cae al default con cualquier basura, sin tirar", () => {
    for (const basura of [null, undefined, 42, {}, [], "", "regional", "LOCALES", NaN, () => {}]) {
      expect(() => normalizeBoostScope(basura)).not.toThrow();
      expect(normalizeBoostScope(basura)).toBe(DEFAULT_BOOST_SCOPE);
    }
  });

  it("respeta un fallback explícito", () => {
    expect(normalizeBoostScope("otra cosa", "local")).toBe("local");
  });
});

describe("parseBoostScope — lo que elige una persona se rechaza, no se adivina", () => {
  it("devuelve null en vez de un default", () => {
    expect(parseBoostScope("regional")).toBeNull();
    expect(parseBoostScope(undefined)).toBeNull();
    expect(parseBoostScope("")).toBeNull();
  });

  it("acepta los tres válidos", () => {
    expect(parseBoostScope("local")).toBe("local");
    expect(parseBoostScope("nacional")).toBe("nacional");
    expect(parseBoostScope("global")).toBe("global");
  });
});

describe("normalizeGeoLabel", () => {
  it("borra tildes, mayúsculas y puntuación", () => {
    expect(normalizeGeoLabel("Bogotá")).toBe("bogota");
    expect(normalizeGeoLabel("  Corona,  Queens ")).toBe("corona queens");
    expect(normalizeGeoLabel("Ciudad de México")).toBe("ciudad de mexico");
  });

  it("con basura devuelve cadena vacía en vez de romper", () => {
    expect(normalizeGeoLabel(null)).toBe("");
    expect(normalizeGeoLabel(undefined)).toBe("");
    expect(normalizeGeoLabel("   ")).toBe("");
  });
});

describe("sameZoneLabel — laxo por token, como escribe la gente", () => {
  it("empareja la zona corta con la larga en los dos sentidos", () => {
    expect(sameZoneLabel("Corona", "Corona, Queens")).toBe(true);
    expect(sameZoneLabel("Corona, Queens", "corona")).toBe(true);
  });

  it("ignora tildes y puntuación", () => {
    expect(sameZoneLabel("Bogotá", "bogota")).toBe(true);
    expect(sameZoneLabel("Queens - Corona", "Corona, Queens")).toBe(false);
  });

  it("zonas distintas no se emparejan", () => {
    expect(sameZoneLabel("Corona", "Washington Heights")).toBe(false);
  });

  it("sin zona no hay match — el vacío no empareja con el vacío", () => {
    expect(sameZoneLabel(null, "Corona")).toBe(false);
    expect(sameZoneLabel("Corona", null)).toBe(false);
    expect(sameZoneLabel(null, null)).toBe(false);
    expect(sameZoneLabel("", "")).toBe(false);
  });
});

describe("sameCountryLabel — igualdad, no contención", () => {
  it("normaliza pero exige igualdad", () => {
    expect(sameCountryLabel("do", "DO")).toBe(true);
    expect(sameCountryLabel("República Dominicana", "republica dominicana")).toBe(true);
  });

  it("no confunde un país con otro que lo contiene", () => {
    expect(sameCountryLabel("República Dominicana", "Dominica")).toBe(false);
  });

  it("sin país no hay match", () => {
    expect(sameCountryLabel(null, "DO")).toBe(false);
    expect(sameCountryLabel("DO", null)).toBe(false);
  });
});

describe("readBoostScopeTarget — no confía en la fila", () => {
  it("lee una fila local completa", () => {
    expect(
      readBoostScopeTarget({ scope: "local", scope_area: "Corona", scope_country: null }),
    ).toEqual({ scope: "local", area: "Corona", country: null });
  });

  it("descarta el objetivo que no corresponde al alcance", () => {
    // Una fila global con zona cargada es imposible por CHECK, pero si llegara
    // de un dump viejo el objetivo se ignora en vez de cambiar el significado.
    expect(
      readBoostScopeTarget({ scope: "global", scope_area: "Corona", scope_country: "DO" }),
    ).toEqual({ scope: "global", area: null, country: null });
    expect(
      readBoostScopeTarget({ scope: "nacional", scope_area: "Corona", scope_country: "DO" }),
    ).toEqual({ scope: "nacional", area: null, country: "DO" });
  });

  it("una fila sin scope se lee con el default de la columna", () => {
    expect(readBoostScopeTarget({}).scope).toBe(DEFAULT_BOOST_SCOPE);
    expect(readBoostScopeTarget({ scope: 7 }).scope).toBe(DEFAULT_BOOST_SCOPE);
  });
});

describe("boostReachesViewer — la pregunta que hace que el alcance no sea decorativo", () => {
  describe("local", () => {
    it("alcanza a quien está en la zona objetivo", () => {
      expect(boostReachesViewer(local("Corona"), { areaLabel: "Corona, Queens", country: "US" })).toBe(true);
    });

    it("NO alcanza a quien está en otra zona", () => {
      expect(boostReachesViewer(local("Corona"), { areaLabel: "Washington Heights", country: "US" })).toBe(false);
    });

    it("NO alcanza a quien no declaró zona — el alcance más barato no puede ser el más grande", () => {
      expect(boostReachesViewer(local("Corona"), { areaLabel: null, country: "US" })).toBe(false);
    });

    it("un local sin zona objetivo no alcanza a nadie (el CHECK lo prohíbe; acá se degrada)", () => {
      expect(boostReachesViewer(local(null), { areaLabel: "Corona", country: "US" })).toBe(false);
    });
  });

  describe("nacional", () => {
    it("alcanza a la comunidad del mismo país, en cualquier zona", () => {
      expect(boostReachesViewer(nacional("DO"), { areaLabel: "Washington Heights", country: "do" })).toBe(true);
      expect(boostReachesViewer(nacional("DO"), { areaLabel: null, country: "DO" })).toBe(true);
    });

    it("NO alcanza a una comunidad de otro país", () => {
      expect(boostReachesViewer(nacional("DO"), { areaLabel: "Miami", country: "MX" })).toBe(false);
    });

    it("ante la duda alcanza: alguien pagó por ese lugar", () => {
      expect(boostReachesViewer(nacional(null), { areaLabel: null, country: "DO" })).toBe(true);
      expect(boostReachesViewer(nacional("DO"), { areaLabel: null, country: null })).toBe(true);
    });
  });

  describe("global", () => {
    it("alcanza a todo el mundo, con o sin datos", () => {
      expect(boostReachesViewer(global_, { areaLabel: null, country: null })).toBe(true);
      expect(boostReachesViewer(global_, { areaLabel: "Corona", country: "MX" })).toBe(true);
    });
  });

  it("los tres alcances están estrictamente ordenados para un mismo espectador de otra zona", () => {
    const forastero = { areaLabel: "Washington Heights", country: "DO" };
    expect(boostReachesViewer(local("Corona"), forastero)).toBe(false);
    expect(boostReachesViewer(nacional("DO"), forastero)).toBe(true);
    expect(boostReachesViewer(global_, forastero)).toBe(true);
  });
});

describe("boostIsOfferedOutside — hacia afuera, ante la duda NO", () => {
  it("global sale a todas las comunidades", () => {
    expect(boostIsOfferedOutside(global_, "MX")).toBe(true);
    expect(boostIsOfferedOutside(global_, null)).toBe(true);
  });

  it("nacional sale sólo a las comunidades del mismo país", () => {
    expect(boostIsOfferedOutside(nacional("DO"), "do")).toBe(true);
    expect(boostIsOfferedOutside(nacional("DO"), "MX")).toBe(false);
  });

  it("nacional sin país cargado se queda en su casa", () => {
    expect(boostIsOfferedOutside(nacional(null), "DO")).toBe(false);
    expect(boostIsOfferedOutside(nacional("DO"), null)).toBe(false);
  });

  it("local nunca sale", () => {
    expect(boostIsOfferedOutside(local("Corona"), "DO")).toBe(false);
    expect(boostIsOfferedOutside(local("Corona"), null)).toBe(false);
  });
});
