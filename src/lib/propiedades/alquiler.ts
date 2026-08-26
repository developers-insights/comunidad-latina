/**
 * =============================================================================
 * CONDICIONES DEL ALQUILER — depósito, cargos, servicios, requisitos, estado
 * =============================================================================
 *
 * Lo que una persona pregunta por chat DIEZ VECES antes de ir a ver un cuarto:
 * cuánto es el depósito, qué más se paga aparte, si la luz está incluida, qué
 * papeles le van a pedir, si viene amueblado y desde cuándo puede mudarse.
 * Hasta hoy nada de eso existía como dato: vivía enterrado en la descripción o
 * directamente no estaba, y el que publica terminaba contestando lo mismo a
 * quince personas.
 *
 * DÓNDE VIVEN: en `listings.attrs` (JSONB libre), al lado de `property_type`,
 * `operation`, `bedrooms` y `sqft`. Mismo criterio que `tipos.ts` y por la misma
 * razón: no hace falta migración, y JUSTAMENTE por eso hace falta este módulo —
 * un JSONB libre no valida nada, así que la única garantía de que lo que se
 * escribe y lo que se lee coinciden es que ambos lados pasen por acá.
 *
 * NO INVENTAMOS VALORES. Una clave ausente significa "no lo declaró", nunca un
 * default. Es el mismo criterio de `tipos.ts`: "sin amueblar" y "no declaró si
 * está amueblado" son dos cosas distintas, y la UI muestra la segunda como
 * ausencia (no aparece el dato), jamás como un negativo.
 *
 * EL CASO DEL DEPÓSITO EN CERO. `deposit_amount` acepta 0 a propósito: "no pido
 * depósito" es una afirmación fuerte y buena para quien alquila, y merece poder
 * decirse. Ausente ≠ 0. Por eso el parser devuelve `number | null` y no `number`
 * con default, y por eso la UI tiene que distinguir "Sin depósito" de no
 * mostrar la línea.
 *
 * Módulo PURO: sin I/O, sin `server-only`. Lo comparten la server action de
 * publicar (escritura), el formulario (client) y el detalle (lectura).
 */

// ---------------------------------------------------------------------------
// Claves de attrs — fuente única para escritura y lectura
// ---------------------------------------------------------------------------

/**
 * En inglés snake_case como TODAS las que ya viven en `listings.attrs`
 * (`bedrooms`, `sqft`, `starts_at`, `employment_type`). Constantes exportadas
 * para que un filtro `attrs->>…` y el INSERT de la action no puedan
 * desincronizarse por un typo.
 */
export const DEPOSIT_ATTR = "deposit_amount";
export const EXTRA_FEES_ATTR = "extra_fees";
export const UTILITIES_ATTR = "utilities_included";
export const REQUIREMENTS_ATTR = "rental_requirements";
export const FURNISHED_ATTR = "furnished";
export const AVAILABLE_FROM_ATTR = "available_from";

// ---------------------------------------------------------------------------
// Amueblado
// ---------------------------------------------------------------------------

/**
 * Tres estados y no dos. "Parcial" existe porque es lo que de verdad se alquila
 * en esta comunidad: el cuarto viene con cama y placard y el resto de la casa
 * está vacío. Obligar a elegir entre "amueblado" y "sin amueblar" haría que la
 * mitad de los avisos diga algo falso.
 */
export const FURNISHED_STATES = ["amueblado", "parcial", "sin_amueblar"] as const;

export type FurnishedState = (typeof FURNISHED_STATES)[number];

export const FURNISHED_LABEL: Record<FurnishedState, string> = {
  amueblado: "Amueblado",
  parcial: "Parcialmente amueblado",
  sin_amueblar: "Sin amueblar",
};

/** Una línea que aclara qué significa cada opción al momento de elegirla. */
export const FURNISHED_HELP: Record<FurnishedState, string> = {
  amueblado: "Se entrega con muebles",
  parcial: "Trae algunos muebles",
  sin_amueblar: "Se entrega vacío",
};

export interface FurnishedOption {
  value: FurnishedState;
  label: string;
  hint: string;
}

export const FURNISHED_OPTIONS: readonly FurnishedOption[] = FURNISHED_STATES.map(
  (value) => ({ value, label: FURNISHED_LABEL[value], hint: FURNISHED_HELP[value] }),
);

// ---------------------------------------------------------------------------
// Servicios incluidos
// ---------------------------------------------------------------------------

/**
 * Lista CURADA y corta. Podría ser texto libre, y sería más flexible: no lo es
 * porque un texto libre no se puede filtrar ni comparar entre dos avisos, que
 * es exactamente para lo que sirve saber si la luz está incluida.
 *
 * El orden es el del bolsillo: primero lo que más se paga aparte en Estados
 * Unidos (luz y calefacción), después lo que suele venir incluido.
 */
export const RENTAL_UTILITIES = [
  { value: "luz", label: "Luz" },
  { value: "gas", label: "Gas" },
  { value: "agua", label: "Agua" },
  { value: "calefaccion", label: "Calefacción" },
  { value: "internet", label: "Internet" },
  { value: "lavanderia", label: "Lavandería" },
  { value: "estacionamiento", label: "Estacionamiento" },
] as const;

export type RentalUtility = (typeof RENTAL_UTILITIES)[number]["value"];

const UTILITY_LABEL = new Map<string, string>(
  RENTAL_UTILITIES.map((option) => [option.value, option.label]),
);

export function isRentalUtility(value: unknown): value is RentalUtility {
  return typeof value === "string" && UTILITY_LABEL.has(value);
}

/** Etiqueta humana, o `null` si el valor no está en el catálogo. */
export function rentalUtilityLabel(value: unknown): string | null {
  return typeof value === "string" ? (UTILITY_LABEL.get(value) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Requisitos para alquilar
// ---------------------------------------------------------------------------

/**
 * Catálogo cerrado, y acá el motivo es más fuerte que la comparabilidad: un
 * campo de texto libre llamado "requisitos" es una invitación a pedir papeles
 * que no se pueden pedir. Con una lista, lo que se publica es lo que la
 * comunidad acordó que se puede pedir, y quien busca sabe de antemano si
 * califica sin tener que escribir para enterarse.
 *
 * Lo que NO está —y no va a estar— es cualquier requisito sobre el estatus
 * migratorio. Todo lo demás que alguien quiera aclarar entra en la descripción,
 * que sí es texto libre y sí pasa por moderación.
 */
export const RENTAL_REQUIREMENTS = [
  { value: "comprobante_ingresos", label: "Comprobante de ingresos" },
  { value: "referencias", label: "Referencias" },
  { value: "historial_credito", label: "Historial de crédito" },
  { value: "deposito_seguridad", label: "Depósito de seguridad" },
  { value: "aval", label: "Aval o cosigner" },
  { value: "seguro_inquilino", label: "Seguro de inquilino" },
  { value: "sin_mascotas", label: "Sin mascotas" },
  { value: "no_fumadores", label: "No fumadores" },
] as const;

export type RentalRequirement = (typeof RENTAL_REQUIREMENTS)[number]["value"];

const REQUIREMENT_LABEL = new Map<string, string>(
  RENTAL_REQUIREMENTS.map((option) => [option.value, option.label]),
);

export function isRentalRequirement(value: unknown): value is RentalRequirement {
  return typeof value === "string" && REQUIREMENT_LABEL.has(value);
}

/** Etiqueta humana, o `null` si el valor no está en el catálogo. */
export function rentalRequirementLabel(value: unknown): string | null {
  return typeof value === "string" ? (REQUIREMENT_LABEL.get(value) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Topes — los mismos del esquema de la server action y del formulario
// ---------------------------------------------------------------------------

/** El depósito más caro que tiene sentido: por encima es un error de tipeo. */
export const MAX_DEPOSIT = 100_000;
/** "Agua $30 y basura $15 por mes" entra de sobra; una novela, no. */
export const MAX_EXTRA_FEES_LENGTH = 200;

// ---------------------------------------------------------------------------
// Normalizadores — NUNCA lanzan
// ---------------------------------------------------------------------------

function canonical(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s./-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean.length > 0 ? clean : null;
}

const FURNISHED_ALIASES: Record<string, FurnishedState> = {
  furnished: "amueblado",
  amoblado: "amueblado",
  con_muebles: "amueblado",
  semi_amueblado: "parcial",
  parcialmente_amueblado: "parcial",
  partially_furnished: "parcial",
  unfurnished: "sin_amueblar",
  vacio: "sin_amueblar",
  sin_muebles: "sin_amueblar",
};

const FURNISHED_SET = new Set<string>(FURNISHED_STATES);

/** Cualquier entrada → `FurnishedState`, o `null` ("no lo declaró"). */
export function normalizeFurnished(value: unknown): FurnishedState | null {
  const key = canonical(value);
  if (key === null) return null;
  if (FURNISHED_SET.has(key)) return key as FurnishedState;
  return FURNISHED_ALIASES[key] ?? null;
}

/** Etiqueta humana del estado de amueblado, o `null` si no se reconoce. */
export function furnishedLabel(value: unknown): string | null {
  const state = normalizeFurnished(value);
  return state === null ? null : FURNISHED_LABEL[state];
}

/**
 * Fecha de disponibilidad → `YYYY-MM-DD`, o `null`.
 *
 * Se guarda como fecha SIN hora y sin zona a propósito: "disponible desde el 1
 * de septiembre" no tiene hora, y convertirlo a un instante UTC haría que en
 * media América se leyera "31 de agosto". El input del formulario es
 * `type="date"`, que ya entrega exactamente este formato.
 */
export function normalizeAvailableFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  // Se valida contra el calendario real: "2026-02-31" pasa el regex y no existe.
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

/**
 * Lista de slugs → lista limpia, sin repetidos, en el ORDEN DEL CATÁLOGO y sin
 * nada que no esté en él.
 *
 * El orden del catálogo y no el de llegada: así dos avisos con los mismos
 * servicios se ven idénticos, en vez de depender de en qué orden tocó los chips
 * cada persona.
 */
function normalizeSlugList<T extends string>(
  raw: unknown,
  catalog: readonly { value: T }[],
): T[] {
  if (!Array.isArray(raw)) return [];
  const chosen = new Set(raw.filter((item): item is string => typeof item === "string"));
  return catalog.map((option) => option.value).filter((value) => chosen.has(value));
}

/** Servicios incluidos declarados, limpios y ordenados por catálogo. */
export function normalizeUtilities(raw: unknown): RentalUtility[] {
  return normalizeSlugList(raw, RENTAL_UTILITIES);
}

/** Requisitos declarados, limpios y ordenados por catálogo. */
export function normalizeRequirements(raw: unknown): RentalRequirement[] {
  return normalizeSlugList(raw, RENTAL_REQUIREMENTS);
}

// ---------------------------------------------------------------------------
// Lectura desde attrs
// ---------------------------------------------------------------------------

export interface RentalTerms {
  /** `null` = no lo declaró. `0` = lo declaró y NO pide depósito. */
  deposit: number | null;
  /** Texto libre corto, ya recortado. `null` si no declaró nada. */
  extraFees: string | null;
  utilities: RentalUtility[];
  requirements: RentalRequirement[];
  furnished: FurnishedState | null;
  /** `YYYY-MM-DD` o `null`. */
  availableFrom: string | null;
}

/** `true` si el aviso no declaró NINGUNA de estas condiciones (aviso viejo). */
export function isEmptyRentalTerms(terms: RentalTerms): boolean {
  return (
    terms.deposit === null &&
    terms.extraFees === null &&
    terms.utilities.length === 0 &&
    terms.requirements.length === 0 &&
    terms.furnished === null &&
    terms.availableFrom === null
  );
}

/**
 * Lee las condiciones de alquiler de un `listings.attrs` cualquiera.
 *
 * ÉSTE es el punto donde se sostiene la retrocompatibilidad: un aviso publicado
 * antes de esta feature no tiene ninguna de las claves y sale con todo en
 * `null` / `[]`. La UI muestra ausencia; nadie escribe "Sin amueblar" en un
 * aviso cuyo dueño nunca lo dijo.
 */
// ---------------------------------------------------------------------------
// Copy de la ficha de condiciones
// ---------------------------------------------------------------------------

/**
 * Los rótulos con los que el detalle muestra estas condiciones.
 *
 * Viven ACÁ y no en `components/listings/copy.ts` por la misma razón que los
 * catálogos: son la otra mitad del mismo contrato. Si mañana se agrega un
 * requisito, el valor, la etiqueta y el rótulo de la fila se tocan en un solo
 * archivo — y no hay forma de agregar un dato y olvidarse de cómo se anuncia.
 *
 * Están escritos como los diría una persona, no como los nombraría un
 * formulario: "Qué piden para alquilar" en vez de "Requisitos", porque es
 * literalmente la pregunta que alguien hace por chat.
 */
export const RENTAL_TERMS_COPY = {
  title: "Condiciones del alquiler",
  deposit: "Depósito",
  /** Declarar 0 es una afirmación fuerte y se muestra como tal, no como "$0". */
  noDeposit: "No pide depósito",
  extraFees: "Se paga aparte",
  utilities: "Incluye",
  requirements: "Qué te van a pedir",
  furnished: "Muebles",
  availableFrom: "Te podés mudar desde",
  footnote:
    "Esto lo declara quien publica el aviso. Confirmalo por chat antes de entregar dinero.",
} as const;

export function readRentalTerms(attrs: unknown): RentalTerms {
  const record =
    attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)
      ? (attrs as Record<string, unknown>)
      : {};

  const rawDeposit = record[DEPOSIT_ATTR];
  const deposit =
    typeof rawDeposit === "number" &&
    Number.isFinite(rawDeposit) &&
    rawDeposit >= 0 &&
    rawDeposit <= MAX_DEPOSIT
      ? rawDeposit
      : null;

  const rawFees = record[EXTRA_FEES_ATTR];
  const extraFees =
    typeof rawFees === "string" && rawFees.trim().length > 0
      ? rawFees.trim().slice(0, MAX_EXTRA_FEES_LENGTH)
      : null;

  return {
    deposit,
    extraFees,
    utilities: normalizeUtilities(record[UTILITIES_ATTR]),
    requirements: normalizeRequirements(record[REQUIREMENTS_ATTR]),
    furnished: normalizeFurnished(record[FURNISHED_ATTR]),
    availableFrom: normalizeAvailableFrom(record[AVAILABLE_FROM_ATTR]),
  };
}
