import { describe, expect, it } from "vitest";
import {
  APPLY_BY_ATTR,
  EXPERIENCE_ATTR,
  JOB_EXPERIENCE_LEVELS,
  JOB_LANGUAGES,
  LANGUAGES_ATTR,
  MAX_SALARY,
  MAX_SCHEDULE_LENGTH,
  SALARY_MAX_ATTR,
  SCHEDULE_ATTR,
  STARTS_ON_ATTR,
  WORK_DAYS,
  WORK_DAYS_ATTR,
  isEmptyJobDetails,
  isJobExperience,
  isJobLanguage,
  isWorkDay,
  jobExperienceLabel,
  jobLanguageLabel,
  normalizeJobDate,
  normalizeLanguages,
  normalizeWorkDays,
  readJobDetails,
  resolveSalaryRange,
  workDayLabel,
} from "./detalles";

/**
 * Estos tests cuidan:
 *
 *  1. Que un empleo VIEJO (sólo `employment_type` + `questions`) siga siendo
 *     legible y no reciba valores inventados.
 *  2. Que el RANGO SALARIAL no pueda quedar al revés, y que un "rango" de $18 a
 *     $18 se guarde como lo que es: un monto único.
 *  3. Que nada lance nunca.
 */

// ---------------------------------------------------------------------------
// Claves y catálogos
// ---------------------------------------------------------------------------

describe("claves de attrs", () => {
  it("quedan fijadas", () => {
    expect(SALARY_MAX_ATTR).toBe("salary_max");
    expect(WORK_DAYS_ATTR).toBe("work_days");
    expect(SCHEDULE_ATTR).toBe("schedule");
    expect(EXPERIENCE_ATTR).toBe("experience");
    expect(LANGUAGES_ATTR).toBe("languages");
    expect(STARTS_ON_ATTR).toBe("starts_on");
    expect(APPLY_BY_ATTR).toBe("apply_by");
  });
});

describe("catálogos", () => {
  it("los días son siete, empiezan en lunes y no se repiten", () => {
    expect(WORK_DAYS).toHaveLength(7);
    expect(WORK_DAYS[0].value).toBe("mon");
    const values = WORK_DAYS.map((day) => day.value);
    expect(new Set(values).size).toBe(7);
    // La abreviatura es lo que se VE; la etiqueta completa es el nombre
    // accesible, porque "X" no se puede escuchar y entender.
    for (const day of WORK_DAYS) {
      expect(day.short).toHaveLength(1);
      expect(day.label.length).toBeGreaterThan(4);
    }
  });

  /**
   * Que "no hace falta experiencia" exista Y esté primera no es un detalle de
   * orden: es el aviso que le abre la puerta a alguien que recién llegó. Si la
   * lista empezara en "hasta 1 año", quien publica elegiría eso por descarte.
   */
  it("la experiencia abre en 'no hace falta'", () => {
    expect(JOB_EXPERIENCE_LEVELS[0].value).toBe("ninguna");
    expect(JOB_EXPERIENCE_LEVELS[0].label.toLowerCase()).toContain("no hace falta");
  });

  it("las guardas reconocen lo del catálogo y rechazan lo demás", () => {
    expect(isWorkDay("mon")).toBe(true);
    expect(isWorkDay("lunes")).toBe(false);
    expect(isJobExperience("1_a_3")).toBe(true);
    expect(isJobExperience("mucha")).toBe(false);
    expect(isJobLanguage("ingles")).toBe(true);
    expect(isJobLanguage("aleman")).toBe(false);
    for (const value of [null, undefined, 42, {}]) {
      expect(isWorkDay(value)).toBe(false);
      expect(isJobExperience(value)).toBe(false);
      expect(isJobLanguage(value)).toBe(false);
    }
  });

  it("las etiquetas salen del catálogo, o null", () => {
    expect(workDayLabel("wed")).toBe("Miércoles");
    expect(workDayLabel("miercoles")).toBeNull();
    expect(jobExperienceLabel("mas_de_3")).toBe("Más de 3 años");
    expect(jobLanguageLabel("creole")).toBe("Creole");
    expect(jobLanguageLabel("aleman")).toBeNull();
  });

  /**
   * Marcar español e inglés YA significa "hacen falta los dos". Una opción
   * "bilingüe" haría que el mismo requisito se pudiera escribir de dos formas
   * distintas, y dos avisos idénticos dejarían de parecerlo.
   */
  it("no hay una opción 'bilingüe' que duplique el significado", () => {
    for (const language of JOB_LANGUAGES) {
      expect(language.value).not.toContain("bilingue");
      expect(language.label.toLowerCase()).not.toContain("bilingüe");
    }
  });
});

// ---------------------------------------------------------------------------
// Normalizadores
// ---------------------------------------------------------------------------

describe("normalizeWorkDays / normalizeLanguages", () => {
  it("devuelven el ORDEN DEL CATÁLOGO, no el de llegada", () => {
    // Dos avisos con los mismos días se leen igual sin importar en qué orden
    // los tocó cada persona.
    expect(normalizeWorkDays(["fri", "mon", "wed"])).toEqual(["mon", "wed", "fri"]);
    expect(normalizeLanguages(["ingles", "espanol"])).toEqual(["espanol", "ingles"]);
  });

  it("descartan repetidos y valores fuera del catálogo", () => {
    expect(normalizeWorkDays(["mon", "mon", "lunes", 3, null])).toEqual(["mon"]);
    expect(normalizeLanguages(["espanol", "aleman"])).toEqual(["espanol"]);
  });

  it("nunca lanzan y devuelven [] ante cualquier cosa que no sea un arreglo", () => {
    for (const value of [null, undefined, "mon", 42, {}]) {
      expect(() => normalizeWorkDays(value)).not.toThrow();
      expect(normalizeWorkDays(value)).toEqual([]);
      expect(normalizeLanguages(value)).toEqual([]);
    }
  });
});

describe("normalizeJobDate", () => {
  it("acepta YYYY-MM-DD tal cual", () => {
    expect(normalizeJobDate("2026-09-01")).toBe("2026-09-01");
    expect(normalizeJobDate(" 2026-09-01 ")).toBe("2026-09-01");
  });

  it("rechaza una fecha que el calendario no tiene", () => {
    expect(normalizeJobDate("2026-02-31")).toBeNull();
    expect(normalizeJobDate("2026-00-10")).toBeNull();
  });

  /**
   * Sin hora ni zona: "empieza el 1 de septiembre" no tiene hora, y un instante
   * UTC lo correría un día para media América.
   */
  it("rechaza cualquier cosa con hora", () => {
    expect(normalizeJobDate("2026-09-01T08:00:00Z")).toBeNull();
  });

  it("nunca lanza", () => {
    for (const value of [null, undefined, 42, {}, [], "la semana que viene"]) {
      expect(() => normalizeJobDate(value)).not.toThrow();
      expect(normalizeJobDate(value)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Rango salarial
// ---------------------------------------------------------------------------

describe("resolveSalaryRange", () => {
  it("un rango normal se conserva entero", () => {
    expect(resolveSalaryRange(18, 22)).toEqual({ ok: true, min: 18, max: 22 });
  });

  it("sin techo es un monto único, no un error", () => {
    // El aviso de monto único sigue siendo el caso más común del vertical.
    for (const value of [null, undefined, ""]) {
      expect(resolveSalaryRange(18, value)).toEqual({ ok: true, min: 18, max: null });
    }
  });

  /**
   * Un "rango" de $18 a $18 no es un rango. Se guarda como monto único, que es
   * exactamente lo que significa — y así la tarjeta no muestra "$18 – $18".
   */
  it("un techo igual al piso se guarda como monto único", () => {
    expect(resolveSalaryRange(18, 18)).toEqual({ ok: true, min: 18, max: null });
  });

  /**
   * Contradicción, no dato incompleto: elegir cuál de los dos gana sería
   * inventar qué quiso decir la persona.
   */
  it("rechaza un techo menor que el piso", () => {
    expect(resolveSalaryRange(22, 18)).toEqual({ ok: false, reason: "max_menor_que_min" });
  });

  it("un techo imposible se lee como ausencia, no tumba el aviso", () => {
    expect(resolveSalaryRange(18, MAX_SALARY + 1).ok).toBe(true);
    expect(resolveSalaryRange(18, -5)).toEqual({ ok: true, min: 18, max: null });
    expect(resolveSalaryRange(18, "cualquier cosa")).toEqual({ ok: true, min: 18, max: null });
  });
});

// ---------------------------------------------------------------------------
// Lectura desde attrs
// ---------------------------------------------------------------------------

describe("readJobDetails", () => {
  /**
   * EL TEST QUE MÁS IMPORTA. Un empleo publicado antes de esta feature sólo
   * tiene `employment_type` y `questions`, que son de otro módulo
   * (`parseJobAttrs`). Todo lo de acá tiene que salir vacío.
   */
  it("un empleo viejo no recibe ningún valor inventado", () => {
    const details = readJobDetails({ employment_type: "part_time", questions: [] });
    expect(details).toEqual({
      salaryMax: null,
      days: [],
      schedule: null,
      experience: null,
      languages: [],
      startsOn: null,
      applyBy: null,
    });
    expect(isEmptyJobDetails(details)).toBe(true);
  });

  it("lee todo lo declarado", () => {
    const details = readJobDetails({
      [SALARY_MAX_ATTR]: 22,
      [WORK_DAYS_ATTR]: ["fri", "mon"],
      [SCHEDULE_ATTR]: "  de 9 a 17  ",
      [EXPERIENCE_ATTR]: "hasta_1",
      [LANGUAGES_ATTR]: ["ingles", "espanol"],
      [STARTS_ON_ATTR]: "2026-09-01",
      [APPLY_BY_ATTR]: "2026-08-25",
    });
    expect(details.salaryMax).toBe(22);
    expect(details.days).toEqual(["mon", "fri"]);
    expect(details.schedule).toBe("de 9 a 17");
    expect(details.experience).toBe("hasta_1");
    expect(details.languages).toEqual(["espanol", "ingles"]);
    expect(details.startsOn).toBe("2026-09-01");
    expect(details.applyBy).toBe("2026-08-25");
    expect(isEmptyJobDetails(details)).toBe(false);
  });

  it("descarta un techo salarial imposible en vez de propagarlo", () => {
    expect(readJobDetails({ [SALARY_MAX_ATTR]: 0 }).salaryMax).toBeNull();
    expect(readJobDetails({ [SALARY_MAX_ATTR]: -5 }).salaryMax).toBeNull();
    expect(readJobDetails({ [SALARY_MAX_ATTR]: MAX_SALARY + 1 }).salaryMax).toBeNull();
    expect(readJobDetails({ [SALARY_MAX_ATTR]: "22" }).salaryMax).toBeNull();
  });

  it("recorta el horario al tope y no toma un string en blanco como declaración", () => {
    const largo = "x".repeat(MAX_SCHEDULE_LENGTH + 40);
    expect(readJobDetails({ [SCHEDULE_ATTR]: largo }).schedule).toHaveLength(MAX_SCHEDULE_LENGTH);
    expect(readJobDetails({ [SCHEDULE_ATTR]: "   " }).schedule).toBeNull();
  });

  it("nunca lanza, con cualquier forma de attrs", () => {
    for (const attrs of [null, undefined, 42, "texto", [], [1, 2]]) {
      expect(() => readJobDetails(attrs)).not.toThrow();
      expect(readJobDetails(attrs).days).toEqual([]);
    }
  });
});
