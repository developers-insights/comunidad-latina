/**
 * =============================================================================
 * DETALLES DEL EMPLEO — rango salarial, días y horario, requisitos, fechas
 * =============================================================================
 *
 * El aviso de empleo capturaba puesto, descripción, un monto único, período,
 * jornada, zona (texto libre) y las 5 preguntas al postulante. La spec pide
 * bastante más, y todo lo que falta es de la clase de dato por el que después
 * hay que escribirse por chat: qué días, en qué horario, cuánta experiencia,
 * qué idioma, desde cuándo y hasta cuándo se puede aplicar.
 *
 * DÓNDE VIVEN: en `listings.attrs`, al lado de `employment_type` y `questions`,
 * que ya están ahí (`components/empleos/helpers.ts`). Dos excepciones que NO
 * van a `attrs`:
 *
 *   · LA MODALIDAD (presencial / a distancia / mixto) ya es una COLUMNA:
 *     `listings.work_mode` existe desde la 0087, con su CHECK y su índice
 *     parcial, y hoy sólo la usa Creadores. Empleos la reusa — crear un
 *     `attrs.work_mode` paralelo sería tener el mismo hecho escrito en dos
 *     lugares que se van a contradecir.
 *   · EL NEGOCIO VINCULADO es la columna `listings.business_listing_id`
 *     (migración 0107). Por qué una columna y no `attrs`: ver el docblock de
 *     esa migración — necesita FK, integridad referencial e índice.
 *
 * EL RANGO SALARIAL, Y POR QUÉ EL MÍNIMO SIGUE SIENDO `price_amount`.
 * La spec pide poder dar un rango ("de $18 a $22 la hora"). El mínimo se sigue
 * guardando en la COLUMNA `price_amount` y sólo el techo va a `attrs`. No es
 * comodidad: `price_amount` es lo que ordena, filtra y formatea TODO el resto
 * de la app (las tarjetas, el orden por precio, `formatListingPrice`). Mover el
 * salario a `attrs` para que "quepa" el rango dejaría a los empleos fuera de
 * todo eso. Con este reparto, un aviso con rango se sigue viendo y ordenando
 * como siempre por su piso, que es además el número honesto para comparar.
 *
 * Módulo PURO: sin I/O, sin `server-only`.
 */

// ---------------------------------------------------------------------------
// Claves de attrs
// ---------------------------------------------------------------------------

export const SALARY_MAX_ATTR = "salary_max";
export const WORK_DAYS_ATTR = "work_days";
export const SCHEDULE_ATTR = "schedule";
export const EXPERIENCE_ATTR = "experience";
export const LANGUAGES_ATTR = "languages";
export const STARTS_ON_ATTR = "starts_on";
export const APPLY_BY_ATTR = "apply_by";

// ---------------------------------------------------------------------------
// Días de trabajo
// ---------------------------------------------------------------------------

/**
 * Lunes primero, como el calendario que usa la app. El valor es la abreviatura
 * canónica en inglés (`mon`…`sun`) porque es la que no se rompe al ordenar ni
 * al comparar, y la etiqueta es la letra que se ve en el chip.
 *
 * Chips de una o dos letras y no un desplegable: en un teléfono, marcar "lunes
 * a viernes" son cinco toques en una fila que entra en el ancho de pantalla,
 * contra siete despliegues de un selector.
 */
export const WORK_DAYS = [
  { value: "mon", short: "L", label: "Lunes" },
  { value: "tue", short: "M", label: "Martes" },
  { value: "wed", short: "X", label: "Miércoles" },
  { value: "thu", short: "J", label: "Jueves" },
  { value: "fri", short: "V", label: "Viernes" },
  { value: "sat", short: "S", label: "Sábado" },
  { value: "sun", short: "D", label: "Domingo" },
] as const;

export type WorkDay = (typeof WORK_DAYS)[number]["value"];

const DAY_LABEL = new Map<string, string>(WORK_DAYS.map((day) => [day.value, day.label]));

export function isWorkDay(value: unknown): value is WorkDay {
  return typeof value === "string" && DAY_LABEL.has(value);
}

/** Nombre completo del día, o `null` si no está en el catálogo. */
export function workDayLabel(value: unknown): string | null {
  return typeof value === "string" ? (DAY_LABEL.get(value) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Experiencia pedida
// ---------------------------------------------------------------------------

/**
 * Cuatro tramos, y el primero es "no hace falta experiencia".
 *
 * Que esa opción exista y esté PRIMERA no es un detalle de orden: en esta
 * comunidad el aviso que dice "no necesitás experiencia" es el que le abre la
 * puerta a alguien que recién llegó. Si la lista empezara en "hasta 1 año", el
 * que publica elegiría eso por descarte y el aviso pediría un requisito que en
 * realidad no tiene.
 */
export const JOB_EXPERIENCE_LEVELS = [
  { value: "ninguna", label: "No hace falta experiencia" },
  { value: "hasta_1", label: "Hasta 1 año" },
  { value: "1_a_3", label: "Entre 1 y 3 años" },
  { value: "mas_de_3", label: "Más de 3 años" },
] as const;

export type JobExperience = (typeof JOB_EXPERIENCE_LEVELS)[number]["value"];

const EXPERIENCE_LABEL = new Map<string, string>(
  JOB_EXPERIENCE_LEVELS.map((level) => [level.value, level.label]),
);

export function isJobExperience(value: unknown): value is JobExperience {
  return typeof value === "string" && EXPERIENCE_LABEL.has(value);
}

/** Etiqueta humana del tramo de experiencia, o `null`. */
export function jobExperienceLabel(value: unknown): string | null {
  return typeof value === "string" ? (EXPERIENCE_LABEL.get(value) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Idiomas
// ---------------------------------------------------------------------------

/**
 * Lista corta y deliberadamente incompleta: son los idiomas que un empleo de
 * esta comunidad pide DE VERDAD. No es un catálogo del mundo, es un filtro
 * útil. Cualquier otro idioma entra en la descripción, que es texto libre.
 *
 * Marcar varios significa "hacen falta los dos", no "cualquiera de los dos":
 * así lo dice la etiqueta del formulario, y por eso no hay una opción
 * "bilingüe" — marcar español e inglés ya lo dice, y tenerla además haría que
 * el mismo requisito se escribiera de dos formas distintas.
 */
export const JOB_LANGUAGES = [
  { value: "espanol", label: "Español" },
  { value: "ingles", label: "Inglés" },
  { value: "portugues", label: "Portugués" },
  { value: "creole", label: "Creole" },
] as const;

export type JobLanguage = (typeof JOB_LANGUAGES)[number]["value"];

const LANGUAGE_LABEL = new Map<string, string>(
  JOB_LANGUAGES.map((language) => [language.value, language.label]),
);

export function isJobLanguage(value: unknown): value is JobLanguage {
  return typeof value === "string" && LANGUAGE_LABEL.has(value);
}

/** Etiqueta humana del idioma, o `null`. */
export function jobLanguageLabel(value: unknown): string | null {
  return typeof value === "string" ? (LANGUAGE_LABEL.get(value) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Topes
// ---------------------------------------------------------------------------

/** "De 9 a 17, con una hora de almuerzo" entra sobrado. */
export const MAX_SCHEDULE_LENGTH = 120;
/** Mismo techo que `price_amount` en el esquema del borrador. */
export const MAX_SALARY = 1_000_000;

// ---------------------------------------------------------------------------
// Normalizadores — NUNCA lanzan
// ---------------------------------------------------------------------------

function normalizeSlugList<T extends string>(
  raw: unknown,
  catalog: readonly { value: T }[],
): T[] {
  if (!Array.isArray(raw)) return [];
  const chosen = new Set(raw.filter((item): item is string => typeof item === "string"));
  // Orden del catálogo, no de llegada: dos avisos con los mismos días se leen
  // igual sin importar en qué orden los tocó cada persona.
  return catalog.map((option) => option.value).filter((value) => chosen.has(value));
}

/** Días declarados, limpios y en orden de semana. */
export function normalizeWorkDays(raw: unknown): WorkDay[] {
  return normalizeSlugList(raw, WORK_DAYS);
}

/** Idiomas declarados, limpios y en orden de catálogo. */
export function normalizeLanguages(raw: unknown): JobLanguage[] {
  return normalizeSlugList(raw, JOB_LANGUAGES);
}

/**
 * Fecha simple `YYYY-MM-DD`, o `null`.
 *
 * Sin hora y sin zona, igual que la disponibilidad de una vivienda: "empieza el
 * 1 de septiembre" no tiene hora, y convertirlo a un instante UTC lo correría un
 * día para media América.
 */
export function normalizeJobDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Rango salarial
// ---------------------------------------------------------------------------

export type SalaryRangeResolution =
  | { ok: true; min: number; max: number | null }
  | { ok: false; reason: "max_menor_que_min" };

/**
 * Piso y techo coherentes.
 *
 * Un techo MENOR que el piso es una contradicción y se rechaza: elegir cuál de
 * los dos gana sería inventar qué quiso decir la persona. Un techo IGUAL al
 * piso no es un rango — se guarda como `null` (o sea, monto único), que es
 * exactamente lo que significa. Un techo ausente o basura tampoco es un error:
 * es un aviso de monto único, que sigue siendo el caso más común.
 */
export function resolveSalaryRange(
  rawMin: unknown,
  rawMax: unknown,
): SalaryRangeResolution {
  const min = Number(rawMin);
  const max = rawMax === null || rawMax === undefined || rawMax === "" ? null : Number(rawMax);

  if (max === null || !Number.isFinite(max) || max <= 0 || max > MAX_SALARY) {
    return { ok: true, min, max: null };
  }
  if (max < min) return { ok: false, reason: "max_menor_que_min" };
  if (max === min) return { ok: true, min, max: null };
  return { ok: true, min, max };
}

// ---------------------------------------------------------------------------
// Lectura desde attrs
// ---------------------------------------------------------------------------

export interface JobDetails {
  /** Techo del rango. `null` = monto único (el piso está en `price_amount`). */
  salaryMax: number | null;
  days: WorkDay[];
  /** Texto libre corto ("De 9 a 17"), ya recortado. `null` si no declaró. */
  schedule: string | null;
  experience: JobExperience | null;
  languages: JobLanguage[];
  /** `YYYY-MM-DD` o `null`. */
  startsOn: string | null;
  applyBy: string | null;
}

/** `true` si el aviso no declaró NINGUNO de estos detalles (aviso viejo). */
export function isEmptyJobDetails(details: JobDetails): boolean {
  return (
    details.salaryMax === null &&
    details.days.length === 0 &&
    details.schedule === null &&
    details.experience === null &&
    details.languages.length === 0 &&
    details.startsOn === null &&
    details.applyBy === null
  );
}

/**
 * Lectura defensiva de `listings.attrs` para `kind='job'`. NUNCA lanza.
 *
 * Complementa —no reemplaza— a `parseJobAttrs` de
 * `components/empleos/helpers.ts`, que sigue siendo el dueño de
 * `employment_type` y `questions`. Se mantienen separados porque las preguntas
 * son el contrato que comparten publicar y postular, y esto es sólo la ficha
 * del puesto.
 */
export function readJobDetails(attrs: unknown): JobDetails {
  const record =
    attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)
      ? (attrs as Record<string, unknown>)
      : {};

  const rawMax = record[SALARY_MAX_ATTR];
  const salaryMax =
    typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax > 0 && rawMax <= MAX_SALARY
      ? rawMax
      : null;

  const rawSchedule = record[SCHEDULE_ATTR];
  const schedule =
    typeof rawSchedule === "string" && rawSchedule.trim().length > 0
      ? rawSchedule.trim().slice(0, MAX_SCHEDULE_LENGTH)
      : null;

  const rawExperience = record[EXPERIENCE_ATTR];

  return {
    salaryMax,
    days: normalizeWorkDays(record[WORK_DAYS_ATTR]),
    schedule,
    experience: isJobExperience(rawExperience) ? rawExperience : null,
    languages: normalizeLanguages(record[LANGUAGES_ATTR]),
    startsOn: normalizeJobDate(record[STARTS_ON_ATTR]),
    applyBy: normalizeJobDate(record[APPLY_BY_ATTR]),
  };
}
