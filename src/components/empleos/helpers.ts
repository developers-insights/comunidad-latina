import { z } from "zod";

/**
 * Contrato de EMPLEOS COMUNITARIOS: attrs del listing `kind='job'` y las
 * preguntas al postulante (feedback Geovanny 24/7 — niñera/mesera/construcción).
 *
 * Las preguntas viven en `listings.attrs.questions` (sin tabla propia: son
 * parte del aviso, se editan con él y viajan juntas). Las respuestas viven en
 * `job_applications.answers` (migración 0040) referenciando `question.id`.
 *
 * Este módulo es PURO (sin I/O): lo comparten el form de publicar (valida
 * preguntas), la server action de postular (valida respuestas contra las
 * preguntas reales del aviso) y la UI de detalle (render).
 */

export const MAX_JOB_QUESTIONS = 5;
export const JOB_QUESTION_MIN_OPTIONS = 2;
export const JOB_QUESTION_MAX_OPTIONS = 6;

/**
 * "one_off" = changa (trabajo de una sola vez, ej. cortar el pasto un fin de
 * semana). Dos slugs candidatos, descartados a propósito:
 *   · "gig" ya es OTRO vertical del producto: `listings.kind = 'creator_gig'`
 *     (Creator Marketplace — gig_applications, gig_contracts, createGigDraft
 *     en creadores/actions.ts). Reusarlo acá mezclaría dos conceptos distintos
 *     bajo la misma palabra.
 *   · "one_time" ya es un PERÍODO DE PAGO (`price_period`, PERIOD_SUFFIX en
 *     components/listings/helpers.ts) y ahora también vive en JOB_PAY_PERIODS
 *     (ver abajo). Un aviso "one_off" pagado "one_time" tendría el mismo
 *     string en dos columnas con dos significados distintos — confuso al leer
 *     la fila cruda o al gregar el código.
 */
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "one_off"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: "Tiempo completo",
  part_time: "Medio tiempo",
  /**
   * NO "Changa": así lo nombró el cliente al pedirlo, pero es jerga
   * rioplatense que buena parte de esta comunidad (mayoría dominicana) no
   * reconoce. "Trabajo por única vez" es preciso pero largo para un chip de
   * mobile. "Ocasional" solo sigue la MISMA elipsis que ya usan las otras dos
   * etiquetas (ninguna dice "empleo de...") y entra cómodo en un chip.
   */
  one_off: "Ocasional",
};

/**
 * Períodos de pago que ofrece el form de empleos (la DB ya admite 'hour').
 * "one_time" (pago único, sin sufijo — PERIOD_SUFFIX ya lo sabe) suma para
 * changas: "US$ 50 por cortar el pasto" no es una tarifa por hora/día/semana/
 * mes, es un monto cerrado por todo el trabajo. Queda disponible para
 * CUALQUIER jornada y no sólo "one_off": un aviso full_time también puede
 * pagarse de una sola vez en algún caso puntual.
 */
export const JOB_PAY_PERIODS = ["hour", "day", "week", "month", "one_time"] as const;
export type JobPayPeriod = (typeof JOB_PAY_PERIODS)[number];

export const jobQuestionSchema = z
  .object({
    id: z.string().min(1).max(40),
    type: z.enum(["yes_no", "multiple_choice"]),
    label: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(3).max(160)),
    options: z
      .array(
        z
          .string()
          .transform((value) => value.trim())
          .pipe(z.string().min(1).max(80)),
      )
      .min(JOB_QUESTION_MIN_OPTIONS)
      .max(JOB_QUESTION_MAX_OPTIONS)
      .optional(),
  })
  .superRefine((question, ctx) => {
    if (question.type === "multiple_choice" && !question.options) {
      ctx.addIssue({
        code: "custom",
        message: "Una pregunta de opción múltiple necesita sus opciones.",
      });
    }
    if (question.type === "yes_no" && question.options) {
      ctx.addIssue({
        code: "custom",
        message: "Una pregunta de sí o no no lleva opciones.",
      });
    }
  });

export const jobQuestionsSchema = z
  .array(jobQuestionSchema)
  .max(MAX_JOB_QUESTIONS);

export type JobQuestion = z.infer<typeof jobQuestionSchema>;

export type JobAnswer = {
  questionId: string;
  /** boolean para yes_no; el texto EXACTO de la opción para multiple_choice. */
  answer: boolean | string;
};

export type JobAttrs = {
  employmentType: EmploymentType | null;
  questions: JobQuestion[];
};

/** Lectura defensiva de `listings.attrs` para kind='job' (nunca lanza). */
export function parseJobAttrs(attrs: unknown): JobAttrs {
  const record =
    attrs && typeof attrs === "object" && !Array.isArray(attrs)
      ? (attrs as Record<string, unknown>)
      : {};

  const employmentType = EMPLOYMENT_TYPES.includes(
    record.employment_type as EmploymentType,
  )
    ? (record.employment_type as EmploymentType)
    : null;

  const parsedQuestions = jobQuestionsSchema.safeParse(record.questions);

  return {
    employmentType,
    questions: parsedQuestions.success ? parsedQuestions.data : [],
  };
}

export type ValidateAnswersResult =
  | { ok: true; clean: JobAnswer[] }
  | { ok: false; message: string };

/**
 * Valida las respuestas del postulante contra las preguntas REALES del aviso
 * (server-side: el cliente puede mandar cualquier cosa). Reglas:
 * - Toda pregunta del aviso debe estar respondida (todas son obligatorias).
 * - yes_no → boolean; multiple_choice → una de sus opciones, textual exacta.
 * - Respuestas a preguntas inexistentes se descartan en silencio.
 */
export function validateJobAnswers(
  questions: JobQuestion[],
  answers: JobAnswer[],
): ValidateAnswersResult {
  const byQuestion = new Map(
    answers
      .filter((entry) => entry && typeof entry.questionId === "string")
      .map((entry) => [entry.questionId, entry.answer] as const),
  );

  const clean: JobAnswer[] = [];
  for (const question of questions) {
    const answer = byQuestion.get(question.id);
    if (answer === undefined) {
      return { ok: false, message: "Respondé todas las preguntas del aviso." };
    }
    if (question.type === "yes_no") {
      if (typeof answer !== "boolean") {
        return { ok: false, message: "Hay una respuesta con formato inválido." };
      }
      clean.push({ questionId: question.id, answer });
      continue;
    }
    if (
      typeof answer !== "string" ||
      !(question.options ?? []).includes(answer)
    ) {
      return { ok: false, message: "Elegí una opción válida en cada pregunta." };
    }
    clean.push({ questionId: question.id, answer });
  }

  return { ok: true, clean };
}

/** Lectura defensiva de `job_applications.answers` (jsonb crudo). Nunca lanza. */
export function parseJobAnswers(raw: unknown): JobAnswer[] {
  if (!Array.isArray(raw)) return [];
  const parsed: JobAnswer[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { questionId, answer } = entry as Record<string, unknown>;
    if (typeof questionId !== "string" || questionId.length === 0) continue;
    if (typeof answer !== "boolean" && typeof answer !== "string") continue;
    parsed.push({ questionId, answer });
  }
  return parsed;
}

/**
 * `answers` jsonb + preguntas del aviso → pares legibles para la vista del
 * dueño. Recorre las PREGUNTAS (no las respuestas), así el orden es el del
 * aviso y las respuestas a preguntas que ya no existen —el aviso se puede
 * editar— quedan afuera solas. Sin respuesta, la pregunta no se muestra.
 */
export function labelJobAnswers(
  questions: JobQuestion[],
  raw: unknown,
): Array<{ question: string; answer: string }> {
  const byQuestion = new Map(
    parseJobAnswers(raw).map((entry) => [entry.questionId, entry.answer] as const),
  );

  const labelled: Array<{ question: string; answer: string }> = [];
  for (const question of questions) {
    const answer = byQuestion.get(question.id);
    if (answer === undefined) continue;
    labelled.push({
      question: question.label,
      answer: typeof answer === "boolean" ? (answer ? "Sí" : "No") : answer,
    });
  }
  return labelled;
}
