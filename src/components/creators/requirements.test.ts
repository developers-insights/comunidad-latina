import { describe, expect, it } from "vitest";
import {
  accountAgeInDays,
  computeCreatorRequirements,
  formatRequirementGap,
  formatRequirementValue,
  REQUIREMENT_TARGETS,
} from "./requirements";

const NOW = new Date("2026-07-30T12:00:00.000Z");

/** Perfil que cumple todo lo medible — base para variar de a un dato. */
const COMPLETO = {
  followers: 1_200,
  videos: 25,
  views: 61_000,
  accountCreatedAt: "2026-01-01T00:00:00.000Z", // ~210 días
  now: NOW,
};

function requirement(
  result: ReturnType<typeof computeCreatorRequirements>,
  id: Parameters<typeof formatRequirementGap>[0]["id"],
) {
  const found = result.requirements.find((item) => item.id === id);
  if (!found) throw new Error(`falta el requisito ${id}`);
  return found;
}

describe("computeCreatorRequirements — los cortes de la spec", () => {
  it("usa exactamente los números del contrato", () => {
    expect(REQUIREMENT_TARGETS).toEqual({
      followers: 1_000,
      videos: 20,
      views: 50_000,
      accountAge: 90,
      creatorScore: 70,
    });
  });

  it("marca cumplido cuando el valor iguala el corte (no solo cuando lo supera)", () => {
    const result = computeCreatorRequirements({
      ...COMPLETO,
      followers: 1_000,
      videos: 20,
      views: 50_000,
      accountCreatedAt: new Date(NOW.getTime() - 90 * 86_400_000).toISOString(),
    });
    expect(requirement(result, "followers").met).toBe(true);
    expect(requirement(result, "videos").met).toBe(true);
    expect(requirement(result, "views").met).toBe(true);
    expect(requirement(result, "accountAge").met).toBe(true);
  });

  it("no marca cumplido con uno menos", () => {
    const result = computeCreatorRequirements({ ...COMPLETO, followers: 999 });
    expect(requirement(result, "followers").met).toBe(false);
    expect(result.meetsAll).toBe(false);
  });
});

describe("computeCreatorRequirements — cuánto falta (el punto de la pantalla)", () => {
  it("dice el número exacto que separa, no un 'no calificás'", () => {
    const result = computeCreatorRequirements({ ...COMPLETO, followers: 820 });
    const followers = requirement(result, "followers");
    expect(followers.remaining).toBe(180);
    expect(formatRequirementGap(followers)).toBe("Te faltan 180 seguidores");
  });

  it("usa singular cuando falta uno solo", () => {
    const result = computeCreatorRequirements({ ...COMPLETO, videos: 19, followers: 999 });
    expect(formatRequirementGap(requirement(result, "videos"))).toBe("Te falta 1 video");
    expect(formatRequirementGap(requirement(result, "followers"))).toBe("Te falta 1 seguidor");
  });

  it("dice 'Listo' cuando ya está y no muestra un faltante negativo", () => {
    const result = computeCreatorRequirements(COMPLETO);
    const views = requirement(result, "views");
    expect(views.remaining).toBe(0);
    expect(formatRequirementGap(views)).toBe("Listo");
  });

  it("da progreso parcial acotado a 1 aunque sobre-cumpla", () => {
    const result = computeCreatorRequirements({ ...COMPLETO, followers: 5_000 });
    expect(requirement(result, "followers").progress).toBe(1);
    const aMedias = computeCreatorRequirements({ ...COMPLETO, followers: 500 });
    expect(requirement(aMedias, "followers").progress).toBe(0.5);
  });

  it("formatea valor actual sobre objetivo, con unidad cuando aplica", () => {
    const result = computeCreatorRequirements({ ...COMPLETO, followers: 820, videos: 12 });
    expect(formatRequirementValue(requirement(result, "followers"))).toBe("820 de 1,000");
    expect(formatRequirementValue(requirement(result, "videos"))).toBe("12 de 20");
    expect(formatRequirementValue(requirement(result, "accountAge"))).toMatch(/de 90 días$/);
  });
});

describe("computeCreatorRequirements — datos que todavía no se miden", () => {
  it("el Creator Score sale 'no medido', no cero", () => {
    const result = computeCreatorRequirements(COMPLETO);
    const score = requirement(result, "creatorScore");
    expect(score.unmeasured).toBe(true);
    expect(score.current).toBeNull();
    expect(score.met).toBe(false);
    expect(formatRequirementGap(score)).toBe("Todavía no lo medimos");
    expect(formatRequirementValue(score)).toBe("—");
  });

  it("un requisito no medido NO bloquea al creador", () => {
    const result = computeCreatorRequirements(COMPLETO);
    expect(result.unmeasured).toEqual(["creatorScore"]);
    expect(result.measurableCount).toBe(4);
    expect(result.metCount).toBe(4);
    expect(result.meetsAll).toBe(true);
  });

  it("acepta el Creator Score el día que exista, sin cambiar nada más", () => {
    const result = computeCreatorRequirements({ ...COMPLETO, creatorScore: 74 });
    const score = requirement(result, "creatorScore");
    expect(score.unmeasured).toBe(false);
    expect(score.met).toBe(true);
    expect(result.measurableCount).toBe(5);
    expect(result.meetsAll).toBe(true);
  });

  it("un dato roto (NaN, Infinity) es 'no medido', no 0", () => {
    const result = computeCreatorRequirements({ ...COMPLETO, followers: Number.NaN });
    expect(requirement(result, "followers").unmeasured).toBe(true);
  });

  it("sin ningún dato no declara que cumple todo", () => {
    const result = computeCreatorRequirements();
    expect(result.measurableCount).toBe(0);
    expect(result.meetsAll).toBe(false);
    expect(result.overallProgress).toBe(0);
  });
});

describe("accountAgeInDays", () => {
  it("cuenta días enteros desde el alta", () => {
    expect(accountAgeInDays("2026-07-01T12:00:00.000Z", NOW)).toBe(29);
    expect(accountAgeInDays(new Date("2026-04-31T12:00:00.000Z"), NOW)).not.toBeNull();
  });

  it("una fecha en el futuro es 0 días, nunca negativa", () => {
    expect(accountAgeInDays("2027-01-01T00:00:00.000Z", NOW)).toBe(0);
  });

  it("una fecha ilegible o ausente es 'no medido'", () => {
    expect(accountAgeInDays("no soy una fecha", NOW)).toBeNull();
    expect(accountAgeInDays(null, NOW)).toBeNull();
    expect(accountAgeInDays(undefined, NOW)).toBeNull();
  });
});

describe("overallProgress", () => {
  it("promedia solo los requisitos medibles", () => {
    // 4 medibles al 50% ⇒ 0.5, aunque el Creator Score no se mida.
    const result = computeCreatorRequirements({
      followers: 500,
      videos: 10,
      views: 25_000,
      accountCreatedAt: new Date(NOW.getTime() - 45 * 86_400_000).toISOString(),
      now: NOW,
    });
    expect(result.overallProgress).toBeCloseTo(0.5, 5);
  });
});
