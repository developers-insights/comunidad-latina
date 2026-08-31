import { describe, expect, it } from "vitest";

import {
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPES,
  JOB_PAY_PERIODS,
  jobQuestionsSchema,
  labelJobAnswers,
  parseJobAnswers,
  parseJobAttrs,
  validateJobAnswers,
  type JobQuestion,
} from "./helpers";

/**
 * Contrato compartido de EMPLEOS (attrs del aviso + respuestas del postulante).
 *
 * Lo que se cuida acá:
 *  - `parseJobAttrs` NUNCA lanza: lee jsonb que puede venir de un seed viejo,
 *    de un aviso importado o de un edit a medio hacer.
 *  - `validateJobAnswers` es la frontera de verdad server-side: el cliente
 *    manda lo que quiere y esto decide qué se guarda.
 *  - El schema de preguntas no deja publicar una pregunta rota (opción múltiple
 *    sin opciones, sí/no con opciones).
 */

/* -------------------------------- Fixtures -------------------------------- */

const YES_NO: JobQuestion = {
  id: "q1",
  type: "yes_no",
  label: "¿Tenés experiencia cuidando niños?",
};

const CHOICE: JobQuestion = {
  id: "q2",
  type: "multiple_choice",
  label: "¿Qué disponibilidad tenés?",
  options: ["Mañanas", "Tardes", "Fines de semana"],
};

/* ------------------------------ parseJobAttrs ----------------------------- */

describe("parseJobAttrs", () => {
  it("lee employment_type y preguntas válidas", () => {
    const attrs = parseJobAttrs({
      employment_type: "part_time",
      questions: [YES_NO, CHOICE],
    });

    expect(attrs.employmentType).toBe("part_time");
    expect(attrs.questions).toHaveLength(2);
    expect(attrs.questions[1].options).toEqual(["Mañanas", "Tardes", "Fines de semana"]);
  });

  /**
   * L1 (changas): tercer valor del enum. Mismo camino que full_time/part_time
   * — nada especial que romper, y es justo lo que hay que probar.
   */
  it("lee el nuevo employment_type 'one_off' (changa) igual que los otros dos", () => {
    expect(parseJobAttrs({ employment_type: "one_off" }).employmentType).toBe("one_off");
  });

  it("no lanza con attrs basura y degrada a valores vacíos", () => {
    for (const raw of [null, undefined, "texto", 42, [], { questions: "nope" }]) {
      const attrs = parseJobAttrs(raw);
      expect(attrs.employmentType).toBeNull();
      expect(attrs.questions).toEqual([]);
    }
  });

  it("descarta un employment_type desconocido en vez de propagarlo", () => {
    expect(parseJobAttrs({ employment_type: "freelance" }).employmentType).toBeNull();
  });

  /**
   * Retrocompatibilidad (hard rule del encargo): hay avisos en producción con
   * "gig" nunca existió como valor real, pero el punto es el mismo que protege
   * a "freelance" — cualquier string que NO esté en EMPLOYMENT_TYPES actual se
   * degrada a null en vez de explotar o colarse. Así un aviso viejo con un
   * valor que quedó obsoleto sigue rindiendo sin romper la pantalla.
   */
  it("un employment_type que dejó de existir se degrada a null sin lanzar", () => {
    expect(parseJobAttrs({ employment_type: "gig" }).employmentType).toBeNull();
  });

  it("si UNA pregunta está rota descarta el bloque entero (no muestra a medias)", () => {
    const attrs = parseJobAttrs({
      questions: [YES_NO, { id: "q9", type: "multiple_choice", label: "Sin opciones" }],
    });
    expect(attrs.questions).toEqual([]);
  });
});

/* ------------------------- EMPLOYMENT_TYPES / labels ----------------------- */

describe("EMPLOYMENT_TYPES / EMPLOYMENT_TYPE_LABEL (L1 — changas)", () => {
  it("incluye las tres categorías, full_time y part_time primero (retrocompatibilidad de orden)", () => {
    expect(EMPLOYMENT_TYPES).toEqual(["full_time", "part_time", "one_off"]);
  });

  it("cada tipo tiene una etiqueta en español, ninguna vacía", () => {
    for (const type of EMPLOYMENT_TYPES) {
      expect(EMPLOYMENT_TYPE_LABEL[type]).toBeTruthy();
    }
  });

  it("la etiqueta de 'one_off' NO es 'Changa' (jerga regional que la comunidad no reconoce)", () => {
    expect(EMPLOYMENT_TYPE_LABEL.one_off).toBe("Ocasional");
    expect(EMPLOYMENT_TYPE_LABEL.one_off.toLowerCase()).not.toContain("changa");
  });
});

/* ------------------------------ JOB_PAY_PERIODS ---------------------------- */

describe("JOB_PAY_PERIODS (L1 — pago único para changas)", () => {
  it("suma 'one_time' sin sacar ninguno de los períodos existentes", () => {
    expect(JOB_PAY_PERIODS).toEqual(["hour", "day", "week", "month", "one_time"]);
  });
});

/* ---------------------------- jobQuestionsSchema -------------------------- */

describe("jobQuestionsSchema", () => {
  it("acepta un set válido de preguntas", () => {
    expect(jobQuestionsSchema.safeParse([YES_NO, CHOICE]).success).toBe(true);
  });

  it("rechaza una opción múltiple sin opciones", () => {
    const result = jobQuestionsSchema.safeParse([
      { id: "q1", type: "multiple_choice", label: "¿Qué turno preferís?" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rechaza un sí/no que trae opciones", () => {
    const result = jobQuestionsSchema.safeParse([
      { id: "q1", type: "yes_no", label: "¿Tenés auto?", options: ["Sí", "No"] },
    ]);
    expect(result.success).toBe(false);
  });

  it("rechaza una opción múltiple con una sola opción", () => {
    const result = jobQuestionsSchema.safeParse([
      { id: "q1", type: "multiple_choice", label: "¿Turno?", options: ["Mañana"] },
    ]);
    expect(result.success).toBe(false);
  });

  it("no deja publicar más de 5 preguntas", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...YES_NO, id: `q${i}` }));
    expect(jobQuestionsSchema.safeParse(many).success).toBe(false);
  });
});

/* --------------------------- validateJobAnswers --------------------------- */

describe("validateJobAnswers", () => {
  it("acepta una postulación completa y devuelve las respuestas limpias", () => {
    const result = validateJobAnswers(
      [YES_NO, CHOICE],
      [
        { questionId: "q1", answer: true },
        { questionId: "q2", answer: "Tardes" },
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("esperaba ok");
    expect(result.clean).toEqual([
      { questionId: "q1", answer: true },
      { questionId: "q2", answer: "Tardes" },
    ]);
  });

  it("corta si falta responder una pregunta del aviso", () => {
    const result = validateJobAnswers([YES_NO, CHOICE], [{ questionId: "q1", answer: false }]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("esperaba fallo");
    expect(result.message).toContain("Respondé todas");
  });

  it("rechaza una opción que no está en la lista del aviso", () => {
    const result = validateJobAnswers([CHOICE], [{ questionId: "q2", answer: "Madrugadas" }]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("esperaba fallo");
    expect(result.message).toContain("opción válida");
  });

  it("rechaza un sí/no respondido con texto (y una opción respondida con boolean)", () => {
    expect(validateJobAnswers([YES_NO], [{ questionId: "q1", answer: "Sí" }]).ok).toBe(false);
    expect(validateJobAnswers([CHOICE], [{ questionId: "q2", answer: true }]).ok).toBe(false);
  });

  it("descarta en silencio las respuestas a preguntas que ya no existen", () => {
    const result = validateJobAnswers(
      [YES_NO],
      [
        { questionId: "q1", answer: true },
        { questionId: "borrada", answer: "cualquier cosa" },
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("esperaba ok");
    // Solo sobrevive lo que el aviso realmente pregunta.
    expect(result.clean).toEqual([{ questionId: "q1", answer: true }]);
  });

  it("un aviso sin preguntas se postula con respuestas vacías", () => {
    const result = validateJobAnswers([], []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("esperaba ok");
    expect(result.clean).toEqual([]);
  });
});

/* ------------------- parseJobAnswers / labelJobAnswers -------------------- */

describe("parseJobAnswers", () => {
  it("filtra entradas inservibles del jsonb sin lanzar", () => {
    const parsed = parseJobAnswers([
      { questionId: "q1", answer: true },
      { questionId: "", answer: "vacío" },
      { questionId: "q2", answer: { raro: 1 } },
      "texto suelto",
      null,
    ]);

    expect(parsed).toEqual([{ questionId: "q1", answer: true }]);
  });

  it("devuelve [] cuando el jsonb no es un array", () => {
    expect(parseJobAnswers({ questionId: "q1" })).toEqual([]);
    expect(parseJobAnswers(null)).toEqual([]);
  });
});

describe("labelJobAnswers", () => {
  it("traduce las respuestas al orden y al idioma del aviso", () => {
    const labelled = labelJobAnswers(
      [YES_NO, CHOICE],
      [
        { questionId: "q2", answer: "Mañanas" },
        { questionId: "q1", answer: false },
      ],
    );

    expect(labelled).toEqual([
      { question: YES_NO.label, answer: "No" },
      { question: CHOICE.label, answer: "Mañanas" },
    ]);
  });

  it("omite las preguntas sin respuesta y las respuestas huérfanas", () => {
    const labelled = labelJobAnswers(
      [YES_NO, CHOICE],
      [
        { questionId: "q1", answer: true },
        { questionId: "vieja", answer: "de un aviso anterior" },
      ],
    );

    expect(labelled).toEqual([{ question: YES_NO.label, answer: "Sí" }]);
  });
});
