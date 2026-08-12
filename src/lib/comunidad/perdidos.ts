import {
  LOST_FOUND_CATEGORIES,
  LOST_FOUND_TYPES,
  type LostFoundAttrs,
  type LostFoundCategory,
  type LostFoundType,
} from "./types";

/**
 * Lógica PURA de Perdido y encontrado: leer y escribir `listings.attrs`, y
 * limpiar lo que llega por la URL. Sin React, sin Supabase, sin `server-only` —
 * lo importan por igual el formulario (cliente), las queries (servidor) y las
 * server actions, y se testea sin montar nada.
 *
 * TODO lo que entra acá es hostil hasta que se demuestre lo contrario: `attrs`
 * es jsonb (nadie garantiza su forma) y los filtros vienen del querystring.
 */

// ---------------------------------------------------------------------------
// attrs ⇄ modelo
// ---------------------------------------------------------------------------

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isLostFoundType(value: string | null): value is LostFoundType {
  return value !== null && (LOST_FOUND_TYPES as readonly string[]).includes(value);
}

function isLostFoundCategory(value: string | null): value is LostFoundCategory {
  return value !== null && (LOST_FOUND_CATEGORIES as readonly string[]).includes(value);
}

/**
 * `YYYY-MM-DD` y que la fecha EXISTA de verdad. `new Date("2026-02-31")` no
 * tira error: se corre sola al 3 de marzo, así que además de la forma hay que
 * comprobar que el día vuelve igual.
 */
export function isPlainDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/** `listings.attrs` → modelo. Lo que no se entiende queda en null, nunca rompe. */
export function parseLostFoundAttrs(raw: unknown): LostFoundAttrs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { type: null, category: null, happenedOn: null, resolvedAt: null };
  }
  const record = raw as Record<string, unknown>;
  const type = readString(record, "lf_type");
  const category = readString(record, "lf_category");
  const happenedOn = readString(record, "lf_happened_on");

  return {
    type: isLostFoundType(type) ? type : null,
    category: isLostFoundCategory(category) ? category : null,
    happenedOn: happenedOn && isPlainDate(happenedOn) ? happenedOn : null,
    resolvedAt: readString(record, "lf_resolved_at"),
  };
}

/**
 * Modelo → `listings.attrs` para el INSERT. Devuelve sólo las claves con valor:
 * escribir `lf_happened_on: null` haría que `marcar_caso_resuelto` y cualquier
 * lectura futura tuvieran que distinguir "ausente" de "explícitamente nulo",
 * que es una distinción sin diferencia.
 */
export function buildLostFoundAttrs(input: {
  type: LostFoundType;
  category: LostFoundCategory;
  happenedOn?: string | null;
}): Record<string, string> {
  const attrs: Record<string, string> = {
    lf_type: input.type,
    lf_category: input.category,
  };
  if (input.happenedOn && isPlainDate(input.happenedOn)) {
    attrs.lf_happened_on = input.happenedOn;
  }
  return attrs;
}

/** Un caso resuelto sigue publicado, pero se muestra distinto y se ordena último. */
export function isResolvedCase(attrs: LostFoundAttrs): boolean {
  return attrs.resolvedAt !== null;
}

// ---------------------------------------------------------------------------
// Filtros que llegan por la URL
// ---------------------------------------------------------------------------

export function toLostFoundType(value: string | null | undefined): LostFoundType | null {
  return isLostFoundType(value ?? null) ? (value as LostFoundType) : null;
}

export function toLostFoundCategory(
  value: string | null | undefined,
): LostFoundCategory | null {
  return isLostFoundCategory(value ?? null) ? (value as LostFoundCategory) : null;
}

/**
 * Zona tecleada por la persona → patrón seguro para un `ilike`.
 *
 * `%` y `_` son comodines de LIKE: sin escaparlos, buscar "_" devuelve la
 * sección entera y buscar "%" también. El `\` va primero o se escaparían las
 * barras que acabamos de poner. Se corta a 80 caracteres (el largo real de
 * `area_label`) para que nadie mande un patrón de 10 kB a la base.
 *
 * Devuelve "" cuando no queda nada útil — el caller no debe filtrar en ese caso.
 */
export function sanitizeAreaFilter(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().slice(0, 80);
  if (value.length < 2) return "";
  return value.replace(/\\/g, "\\\\").replace(/[%_]/g, (char) => `\\${char}`);
}

/**
 * Fecha aproximada aceptable para "cuándo pasó": ni en el futuro ni hace más de
 * dos años. Un caso de hace tres años no es un caso, es archivo — y una fecha
 * futura sólo puede ser un error de tipeo o basura.
 */
export const LOST_FOUND_MAX_AGE_DAYS = 730;

export function isAcceptableHappenedOn(value: string, today = new Date()): boolean {
  if (!isPlainDate(value)) return false;
  const when = new Date(`${value}T00:00:00Z`).getTime();
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (when > now) return false;
  const days = (now - when) / 86_400_000;
  return days <= LOST_FOUND_MAX_AGE_DAYS;
}

/**
 * Orden de la lista: primero lo que sigue abierto (por fecha de publicación),
 * después lo resuelto. Lo resuelto NO se esconde —ver que algo apareció es la
 * mejor prueba de que la sección sirve— pero tampoco puede tapar a quien
 * todavía está buscando.
 *
 * Es una función pura sobre el arreglo ya paginado: no reordena la base.
 */
export function sortCasesOpenFirst<T extends { resolvedAt: string | null }>(
  cases: readonly T[],
): T[] {
  return [
    ...cases.filter((item) => item.resolvedAt === null),
    ...cases.filter((item) => item.resolvedAt !== null),
  ];
}
