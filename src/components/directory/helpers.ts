import type { Json } from "@/lib/types/database.types";

/**
 * Helpers puros del módulo DIRECTORIOS (profesionales + eventos).
 * Sin dependencias de servidor: usables desde Server Components y client
 * components por igual.
 */

// ---------------------------------------------------------------------------
// Rubros de profesionales (attrs.category)
// ---------------------------------------------------------------------------

export const PROFESSIONAL_CATEGORIES = [
  { value: "abogado", label: "Abogado" },
  { value: "contador", label: "Contador" },
  { value: "notario", label: "Notario" },
  { value: "salud", label: "Salud" },
  { value: "educacion", label: "Educación" },
  { value: "otro", label: "Otro" },
] as const;

export type ProfessionalCategory = (typeof PROFESSIONAL_CATEGORIES)[number]["value"];

const CATEGORY_LABELS = new Map<string, string>(
  PROFESSIONAL_CATEGORIES.map((c) => [c.value, c.label]),
);

export function isProfessionalCategory(value: string): value is ProfessionalCategory {
  return CATEGORY_LABELS.has(value);
}

/** Etiqueta legible del rubro; valores desconocidos caen en "Otro". */
export function categoryLabel(value: string | null): string {
  if (!value) return "Otro";
  return CATEGORY_LABELS.get(value) ?? "Otro";
}

// ---------------------------------------------------------------------------
// attrs de profesional
// ---------------------------------------------------------------------------

function asRecord(attrs: Json): Record<string, unknown> {
  return attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)
    ? (attrs as Record<string, unknown>)
    : {};
}

export interface ProfessionalAttrs {
  category: string | null;
  /** Credenciales declaradas por el profesional (texto libre, normalizado a lista). */
  credentials: string[];
}

export function parseProfessionalAttrs(attrs: Json): ProfessionalAttrs {
  const record = asRecord(attrs);
  const category = typeof record.category === "string" ? record.category : null;

  let credentials: string[] = [];
  if (Array.isArray(record.credentials)) {
    credentials = record.credentials.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  } else if (typeof record.credentials === "string" && record.credentials.trim()) {
    // Texto libre: separado por comas o punto y coma.
    credentials = record.credentials
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return { category, credentials: credentials.slice(0, 8) };
}

// ---------------------------------------------------------------------------
// attrs de evento
// ---------------------------------------------------------------------------

export interface EventAttrs {
  /** ISO 8601 (attrs.starts_at canónico; attrs.date como fallback). */
  startsAt: string | null;
  endsAt: string | null;
  /** Zona del evento (attrs.venue_area; el caller cae a area_label). */
  venueArea: string | null;
  free: boolean;
}

function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

export function parseEventAttrs(attrs: Json): EventAttrs {
  const record = asRecord(attrs);
  return {
    startsAt: asIsoDate(record.starts_at) ?? asIsoDate(record.date),
    endsAt: asIsoDate(record.ends_at),
    venueArea:
      typeof record.venue_area === "string" && record.venue_area.trim()
        ? record.venue_area
        : null,
    free: record.free === true,
  };
}

// ---------------------------------------------------------------------------
// Fecha editorial del evento (bloque día/mes + línea completa)
// ---------------------------------------------------------------------------

export interface EventDateParts {
  /** "15" */
  day: string;
  /** "AGO" */
  month: string;
  /** "sábado 15 de agosto" */
  full: string;
  /** "16:00" (vacío si la hora es exactamente medianoche, señal de fecha sin hora). */
  time: string;
  isPast: boolean;
}

export function eventDateParts(iso: string, locale = "es-US"): EventDateParts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat(locale, { day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat(locale, { month: "short" })
    .format(date)
    .replace(/\./g, "")
    .toUpperCase();
  const full = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  const hasTime = /T\d{2}:\d{2}/.test(iso) && !/T00:00(?::00)?(?:[Z+-]|$)/.test(iso);
  const time = hasTime
    ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)
    : "";
  return { day, month, full, time, isPast: date.getTime() < Date.now() - 6 * 60 * 60 * 1000 };
}
