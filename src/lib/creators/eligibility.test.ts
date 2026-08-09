import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELIGIBILITY_CONFIG,
  ELIGIBILITY_REASONS,
  THRESHOLD_FIELDS,
  computeEligibilityImpact,
  configFromRow,
  configToRow,
  evaluateEligibility,
  type EligibilityConfig,
  type EligibilitySubject,
} from "./eligibility";

/**
 * Este módulo es un ESPEJO de `app.creator_activation_eligible()` (0064). Su
 * valor entero depende de que refleje el SQL, así que lo que se fija acá es
 * justamente eso: el orden de los códigos, las guardas `if umbral > 0` y la
 * diferencia entre "no cumple" y "no lo sabemos".
 *
 * Si un día la migración cambia y estos tests siguen en verde, el espejo se
 * rompió en silencio — que es exactamente el escenario que estos tests existen
 * para hacer ruidoso.
 */

/** Alguien que cumple todo lo que se le pueda pedir. */
function perfectSubject(): EligibilitySubject {
  return {
    exists: true,
    ageConfirmed: true,
    ageYears: 40,
    profileCompletePublic: true,
    hasLastName: true,
    phoneVerified: true,
    emailVerified: true,
    identityVerified: true,
    userScore: 100,
    accountActive: true,
    marketplaceRestricted: false,
    stripeConnectReady: true,
    portfolioItems: 50,
    followers: 10_000,
    videos: 100,
    views: 1_000_000,
    creatorTermsAccepted: true,
  };
}

/** Todos los umbrales prendidos y en valores exigentes. */
const STRICT: EligibilityConfig = {
  minAge: 18,
  requireProfileComplete: true,
  requirePhoneVerified: true,
  requireEmailVerified: true,
  minUserScore: 50,
  requireIdentityVerified: true,
  requireStripeConnect: true,
  minFollowers: 100,
  minVideos: 20,
  minViews: 50_000,
  minPortfolioItems: 3,
  requireNoActiveSuspension: true,
  requireCreatorTerms: true,
};

describe("configFromRow / configToRow", () => {
  it("sin fila devuelve los defaults de la base — 'no hay fila' no es un caso aparte", () => {
    expect(configFromRow(null)).toEqual(DEFAULT_ELIGIBILITY_CONFIG);
  });

  it("los defaults reproducen los de la migración 0064", () => {
    // Copiados de `app.creator_eligibility_config()`. Si esto se separa, el
    // panel le miente al admin sobre lo que rige hoy en su comunidad.
    expect(DEFAULT_ELIGIBILITY_CONFIG).toEqual({
      minAge: 18,
      requireProfileComplete: false,
      requirePhoneVerified: true,
      requireEmailVerified: true,
      minUserScore: 50,
      requireIdentityVerified: true,
      requireStripeConnect: false,
      minFollowers: 0,
      minVideos: 0,
      minViews: 0,
      minPortfolioItems: 3,
      requireNoActiveSuspension: true,
      requireCreatorTerms: false,
    });
  });

  it("las tres banderas de decisión de producto siguen apagadas por default", () => {
    // Prenderlas dejaría inelegibles de golpe a los creadores ya aprobados.
    // Es una decisión del dueño de la comunidad, que se toma desde el panel.
    expect(DEFAULT_ELIGIBILITY_CONFIG.requireProfileComplete).toBe(false);
    expect(DEFAULT_ELIGIBILITY_CONFIG.requireStripeConnect).toBe(false);
    expect(DEFAULT_ELIGIBILITY_CONFIG.requireCreatorTerms).toBe(false);
  });

  it("va y vuelve sin perder nada", () => {
    expect(configFromRow(configToRow(STRICT))).toEqual(STRICT);
  });

  it("una columna corrupta cae al default en vez de romper la pantalla", () => {
    const config = configFromRow({ min_age: Number.NaN, require_phone_verified: undefined });
    expect(config.minAge).toBe(18);
    expect(config.requirePhoneVerified).toBe(true);
  });
});

describe("THRESHOLD_FIELDS", () => {
  it("cubre las 13 columnas configurables y ninguna dos veces", () => {
    const columns = THRESHOLD_FIELDS.map((field) => field.column);
    expect(columns).toHaveLength(13);
    expect(new Set(columns).size).toBe(13);
    expect(new Set(columns)).toEqual(new Set(Object.keys(configToRow(STRICT))));
  });

  it("cada umbral explica su EFECTO, no solo su nombre", () => {
    // Un panel que dice "min_views: 50000" y nada más obliga al admin a
    // adivinar. La regla es que el texto exista y sea una frase, no una
    // etiqueta repetida.
    for (const field of THRESHOLD_FIELDS) {
      expect(field.effect.length, field.column).toBeGreaterThan(40);
      expect(field.effect).not.toBe(field.label);
    }
  });

  it("las tres banderas peligrosas llevan su advertencia", () => {
    const warned = THRESHOLD_FIELDS.filter((field) => field.warning).map((field) => field.key);
    expect(warned).toContain("requireProfileComplete");
    expect(warned).toContain("requireStripeConnect");
    expect(warned).toContain("requireCreatorTerms");
  });
});

describe("evaluateEligibility", () => {
  it("un perfil que cumple todo es elegible y no deja motivos", () => {
    const result = evaluateEligibility(STRICT, perfectSubject());
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.unknown).toEqual([]);
  });

  it("un perfil inexistente corta antes que nada, igual que el SQL", () => {
    const result = evaluateEligibility(STRICT, { ...perfectSubject(), exists: false });
    expect(result.reasons).toEqual(["perfil_inexistente"]);
    expect(result.eligible).toBe(false);
  });

  it("devuelve los motivos en el MISMO orden en que los agrega la función de la base", () => {
    const nobody: EligibilitySubject = {
      exists: true,
      ageConfirmed: false,
      ageYears: 12,
      profileCompletePublic: false,
      hasLastName: false,
      phoneVerified: false,
      emailVerified: false,
      identityVerified: false,
      userScore: 0,
      accountActive: true,
      marketplaceRestricted: true,
      stripeConnectReady: false,
      portfolioItems: 0,
      followers: 0,
      videos: 0,
      views: 0,
      creatorTermsAccepted: false,
    };

    expect(evaluateEligibility(STRICT, nobody).reasons).toEqual([
      "edad_minima",
      "perfil_incompleto",
      "telefono",
      "correo",
      "identidad",
      "user_score",
      "restriccion_marketplace",
      "stripe_connect",
      "portafolio",
      "seguidores",
      "videos",
      "vistas",
      "terminos_creador",
    ]);
  });

  it("cuenta suspendida NO acumula además restricción de marketplace (el SQL es if/elsif)", () => {
    const result = evaluateEligibility(STRICT, {
      ...perfectSubject(),
      accountActive: false,
      marketplaceRestricted: true,
    });
    expect(result.reasons).toContain("cuenta_activa");
    expect(result.reasons).not.toContain("restriccion_marketplace");
  });

  it("un umbral en 0 NO es un requisito cumplido: no se evalúa ni aparece en la lista", () => {
    // Es la diferencia entre "tu comunidad no pide seguidores" y "ya tenés los
    // seguidores que pide". Mostrar lo segundo haría creer que se exige algo.
    const config: EligibilityConfig = { ...STRICT, minFollowers: 0, minVideos: 0, minViews: 0 };
    const result = evaluateEligibility(config, { ...perfectSubject(), followers: 0, videos: 0, views: 0 });

    const shown = result.checks.map((check) => check.reason);
    expect(shown).not.toContain("seguidores");
    expect(shown).not.toContain("videos");
    expect(shown).not.toContain("vistas");
    expect(result.eligible).toBe(true);
  });

  it("una bandera apagada saca el requisito de la lista del aspirante", () => {
    const config: EligibilityConfig = {
      ...STRICT,
      requireStripeConnect: false,
      requireCreatorTerms: false,
      requireProfileComplete: false,
    };
    const result = evaluateEligibility(config, {
      ...perfectSubject(),
      stripeConnectReady: false,
      creatorTermsAccepted: false,
      profileCompletePublic: false,
      hasLastName: false,
    });

    const shown = result.checks.map((check) => check.reason);
    expect(shown).not.toContain("stripe_connect");
    expect(shown).not.toContain("terminos_creador");
    expect(shown).not.toContain("perfil_incompleto");
    expect(result.eligible).toBe(true);
  });

  it("haber confirmado la mayoría de edad alcanza aunque no haya fecha de nacimiento", () => {
    const result = evaluateEligibility(STRICT, {
      ...perfectSubject(),
      ageConfirmed: true,
      ageYears: null,
    });
    expect(result.reasons).not.toContain("edad_minima");
  });

  it("informa cuánto falta, no solo que falta", () => {
    const result = evaluateEligibility(
      { ...STRICT, minFollowers: 100 },
      { ...perfectSubject(), followers: 60 },
    );
    const followers = result.checks.find((check) => check.reason === "seguidores");
    expect(followers).toMatchObject({ status: "missing", current: 60, target: 100, remaining: 40 });
  });

  it("un dato que no se pudo leer es 'no se sabe', NUNCA 'no cumple'", () => {
    // Un `null` acá es una consulta que falló o un dato privado. Contarlo como
    // incumplimiento sería acusar a alguien por un problema nuestro.
    const result = evaluateEligibility(STRICT, { ...perfectSubject(), followers: null });
    expect(result.reasons).not.toContain("seguidores");
    expect(result.unknown).toContain("seguidores");
    expect(result.eligible).toBe(false);
  });

  it("perfil incompleto: si falta un campo público no hace falta ver el apellido", () => {
    const result = evaluateEligibility(STRICT, {
      ...perfectSubject(),
      profileCompletePublic: false,
      hasLastName: null,
    });
    expect(result.reasons).toContain("perfil_incompleto");
    expect(result.unknown).not.toContain("perfil_incompleto");
  });

  it("perfil incompleto: con los campos públicos ok y el apellido ilegible, no se afirma nada", () => {
    const result = evaluateEligibility(STRICT, {
      ...perfectSubject(),
      profileCompletePublic: true,
      hasLastName: null,
    });
    expect(result.unknown).toContain("perfil_incompleto");
    expect(result.reasons).not.toContain("perfil_incompleto");
  });
});

describe("computeEligibilityImpact", () => {
  const config: EligibilityConfig = { ...DEFAULT_ELIGIBILITY_CONFIG, minFollowers: 100 };

  it("cuenta cuántos quedan fuera con la configuración que está por guardarse", () => {
    const subjects: EligibilitySubject[] = [
      { ...perfectSubject(), followers: 500 },
      { ...perfectSubject(), followers: 60 },
      { ...perfectSubject(), followers: 10 },
    ];

    const impact = computeEligibilityImpact(config, subjects);
    expect(impact).toMatchObject({ total: 3, eligible: 1, excluded: 2, undetermined: 0 });
    expect(impact.byReason.seguidores).toBe(2);
  });

  it("subir el umbral aumenta los excluidos — es la cuenta que el panel muestra en vivo", () => {
    const subjects = [100, 200, 300, 400, 500].map((followers) => ({
      ...perfectSubject(),
      followers,
    }));

    expect(computeEligibilityImpact({ ...config, minFollowers: 100 }, subjects).excluded).toBe(0);
    expect(computeEligibilityImpact({ ...config, minFollowers: 500 }, subjects).excluded).toBe(4);
  });

  it("quien tiene un dato ilegible se cuenta aparte, no como excluido", () => {
    const impact = computeEligibilityImpact(config, [
      { ...perfectSubject(), followers: null },
      { ...perfectSubject(), followers: 10 },
    ]);
    expect(impact).toMatchObject({ excluded: 1, undetermined: 1, eligible: 0 });
  });

  it("sin creadores no inventa un impacto", () => {
    expect(computeEligibilityImpact(config, [])).toMatchObject({
      total: 0,
      eligible: 0,
      excluded: 0,
      undetermined: 0,
    });
  });
});

describe("ELIGIBILITY_REASONS", () => {
  it("son los 15 códigos que puede devolver la función de la base", () => {
    expect([...ELIGIBILITY_REASONS]).toEqual([
      "perfil_inexistente",
      "edad_minima",
      "perfil_incompleto",
      "telefono",
      "correo",
      "identidad",
      "user_score",
      "cuenta_activa",
      "restriccion_marketplace",
      "stripe_connect",
      "portafolio",
      "seguidores",
      "videos",
      "vistas",
      "terminos_creador",
    ]);
  });
});
