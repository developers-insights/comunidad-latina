/**
 * =============================================================================
 * DETALLES DEL EVENTO — modalidad, entrada, boletos, capacidad, público
 * =============================================================================
 *
 * El formulario de eventos capturaba UN dato: la fecha. Todo lo demás que la
 * spec pide —si es presencial o en línea, si se cobra entrada, dónde se sacan
 * los boletos, cuánta gente entra, para quién es— no existía, y sin embargo
 * `parseEventAttrs` (src/components/directory/helpers.ts) ya leía `attrs.free`
 * y `attrs.ends_at`. Los escribían los scripts de seed y nadie más: la app
 * mostraba "Gratis" en eventos sembrados y en ninguno real.
 *
 * Este módulo es el contrato que faltaba del lado de la ESCRITURA, con las
 * mismas claves que ya se leen. `starts_at`, `ends_at`, `free` y `venue_area`
 * NO se renombran: son las que hay en producción.
 *
 * ── EL ENLACE DE BOLETOS: DOS CAMPOS, UNA REGLA ──────────────────────────────
 * Ya existía `listings.cta_tickets_url`, pero es del módulo de MONETIZACIÓN y
 * la base lo reserva a premium con un CHECK de tabla (`listings_cta_premium_only`,
 * 0048): un aviso `free` no puede ni siquiera GUARDAR esa columna — el INSERT
 * falla. Y un aviso NACE free (lo exige `listings_insert`). O sea que el enlace
 * del formulario base no puede vivir ahí ni escribiéndolo con cuidado.
 *
 * Por eso el enlace base vive en `attrs.tickets_url`, es gratis y lo carga
 * cualquiera al publicar. Los dos campos conviven, y la regla de desempate es
 * **gana el premium**:
 *
 *   1. `cta_tickets_url` está validado por la base (esquema http/https, ≤500) y
 *      es el que edita el panel de botones pago. Si alguien pagó y lo cargó, ése
 *      es el que quiso mostrar.
 *   2. `attrs.tickets_url` es el respaldo: lo que cargó al publicar, antes de
 *      pagar nada. Sigue vivo, y si el premium vence o se limpia, vuelve solo.
 *
 * `resolveEventTicketsUrl()` es esa regla escrita una sola vez. Quien pinte el
 * botón la llama en vez de decidir por su cuenta.
 *
 * Módulo PURO. Sin I/O, sin `server-only`.
 */

import { safeExternalHref } from "@/lib/url/safe-href";
import { isEventAudience, isEventCategory } from "./categorias";

// ---------------------------------------------------------------------------
// Claves de attrs — las de producción, sin renombrar
// ---------------------------------------------------------------------------

export const EVENT_STARTS_ATTR = "starts_at";
export const EVENT_ENDS_ATTR = "ends_at";
export const EVENT_FREE_ATTR = "free";
export const EVENT_VENUE_AREA_ATTR = "venue_area";
/** Claves nuevas de esta feature. */
export const EVENT_CATEGORY_ATTR = "category";
export const EVENT_MODE_ATTR = "event_mode";
export const EVENT_ONLINE_URL_ATTR = "online_url";
export const EVENT_TICKETS_URL_ATTR = "tickets_url";
export const EVENT_CAPACITY_ATTR = "capacity";
export const EVENT_AUDIENCE_ATTR = "audience";

// ---------------------------------------------------------------------------
// Modalidad: dirección física O enlace virtual
// ---------------------------------------------------------------------------

/**
 * La spec pide que la elección sea EXPLÍCITA, y tiene razón: un evento con la
 * zona vacía puede ser uno en línea o uno al que le faltó completar la
 * dirección, y desde afuera se ven igual. Declararlo convierte esa ambigüedad
 * en un dato, y de paso permite que la zona deje de ser obligatoria cuando de
 * verdad no aplica.
 */
export const EVENT_MODES = ["presencial", "virtual"] as const;

export type EventMode = (typeof EVENT_MODES)[number];

export const EVENT_MODE_LABEL: Record<EventMode, string> = {
  presencial: "En un lugar",
  virtual: "En línea",
};

export const EVENT_MODE_HELP: Record<EventMode, string> = {
  presencial: "Hay una dirección a la que ir",
  virtual: "Se entra por un enlace",
};

export interface EventModeOption {
  value: EventMode;
  label: string;
  hint: string;
}

export const EVENT_MODE_OPTIONS: readonly EventModeOption[] = EVENT_MODES.map((value) => ({
  value,
  label: EVENT_MODE_LABEL[value],
  hint: EVENT_MODE_HELP[value],
}));

const EVENT_MODE_SET = new Set<string>(EVENT_MODES);

/** Cualquier entrada → `EventMode`, o `null` ("no lo declaró"). */
export function normalizeEventMode(value: unknown): EventMode | null {
  if (typeof value !== "string") return null;
  const clean = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (EVENT_MODE_SET.has(clean)) return clean as EventMode;
  // Sinónimos que puede haber dejado un seed o un cliente viejo.
  if (clean === "online" || clean === "remoto" || clean === "en_linea") return "virtual";
  if (clean === "in_person" || clean === "presencial_") return "presencial";
  return null;
}

/** `true` si esta modalidad necesita que el aviso diga DÓNDE queda. */
export function requiresVenue(mode: EventMode | null): boolean {
  return mode !== "virtual";
}

// ---------------------------------------------------------------------------
// Topes
// ---------------------------------------------------------------------------

/**
 * Capacidad máxima admitida. 100.000 es más que cualquier evento que esta
 * comunidad vaya a organizar, y el tope no está para acotar la ambición sino
 * para que un dedo pesado sobre el teclado no publique "cupo: 900000000".
 */
export const MAX_EVENT_CAPACITY = 100_000;
/** Igual que las columnas cta_* de la 0048: los enlaces no pasan de 500. */
export const MAX_EVENT_URL_LENGTH = 500;

// ---------------------------------------------------------------------------
// Normalizadores — NUNCA lanzan
// ---------------------------------------------------------------------------

/**
 * URL externa válida, o `null`.
 *
 * Pasa por `safeExternalHref`, que clasifica por ORIGEN RESUELTO y no por
 * prefijo de string: un `javascript:` resuelve a origen "null" y cae. Se exige
 * además que sea EXTERNA — un enlace de boletos que apunte a una ruta interna
 * de la propia app no es un enlace de boletos, es un error de tipeo con forma
 * de botón.
 */
export function normalizeEventUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_EVENT_URL_LENGTH) return null;
  const safe = safeExternalHref(trimmed);
  if (!safe || !safe.external) return null;
  return safe.href.length > MAX_EVENT_URL_LENGTH ? null : safe.href;
}

/** Capacidad declarada → entero positivo dentro del tope, o `null`. */
export function normalizeCapacity(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.trunc(numeric);
  if (rounded < 1 || rounded > MAX_EVENT_CAPACITY) return null;
  return rounded;
}

function asIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

// ---------------------------------------------------------------------------
// Coherencia de fechas
// ---------------------------------------------------------------------------

export type EventDatesResolution =
  | { ok: true; startsAt: string; endsAt: string | null }
  | { ok: false; reason: "sin_inicio" | "fin_antes_del_inicio" };

/**
 * Inicio y fin coherentes, en ISO canónico.
 *
 * Un fin ANTERIOR al inicio es una contradicción, no un dato incompleto: se
 * rechaza en vez de descartar el fin en silencio. Si se descartara, la persona
 * publicaría convencida de haber puesto un horario de cierre que nadie va a
 * ver. Un fin IGUAL al inicio también se rechaza — un evento que termina cuando
 * empieza no es un evento.
 */
export function resolveEventDates(
  rawStart: unknown,
  rawEnd: unknown,
): EventDatesResolution {
  const start = asIso(rawStart);
  if (start === null) return { ok: false, reason: "sin_inicio" };
  const startsAt = new Date(start).toISOString();

  const end = asIso(rawEnd);
  if (end === null) return { ok: true, startsAt, endsAt: null };

  const endsAt = new Date(end).toISOString();
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { ok: false, reason: "fin_antes_del_inicio" };
  }
  return { ok: true, startsAt, endsAt };
}

// ---------------------------------------------------------------------------
// Enlace de boletos: base (gratis) vs premium
// ---------------------------------------------------------------------------

export interface ResolvedTicketsUrl {
  href: string;
  /** De dónde salió — para poder explicar la precedencia sin adivinarla. */
  source: "premium" | "base";
}

/**
 * Enlace de boletos que hay que mostrar. Ver el docblock del módulo: gana el
 * premium, el de `attrs` es el respaldo, y los dos pasan por la misma
 * validación antes de convertirse en un botón.
 *
 * Se le pasa la columna cruda de `listings` y el `attrs` completo, para que
 * quien renderiza no tenga que saber dónde vive cada uno.
 */
export function resolveEventTicketsUrl(
  ctaTicketsUrl: unknown,
  attrs: unknown,
): ResolvedTicketsUrl | null {
  const premium = normalizeEventUrl(ctaTicketsUrl);
  if (premium) return { href: premium, source: "premium" };

  const record =
    attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)
      ? (attrs as Record<string, unknown>)
      : {};
  const base = normalizeEventUrl(record[EVENT_TICKETS_URL_ATTR]);
  return base ? { href: base, source: "base" } : null;
}

// ---------------------------------------------------------------------------
// Copy de la ficha del evento
// ---------------------------------------------------------------------------

/**
 * Rótulos con los que el detalle muestra estos datos.
 *
 * Viven acá, junto a los catálogos, por el mismo motivo que en `alquiler.ts`:
 * agregar un dato y olvidarse de cómo se anuncia deja de ser posible cuando el
 * valor, la etiqueta y el rótulo se tocan en un solo archivo.
 */
export const EVENT_DETAILS_COPY = {
  title: "Detalles del evento",
  category: "Tipo de evento",
  endsAt: "Termina",
  audience: "Para quién es",
  capacity: "Cupo",
  capacityValue: (n: number) => `${n.toLocaleString("es-US")} lugares`,
  onlineTitle: "Se entra por acá",
  onlineCta: "Abrir el enlace del evento",
  ticketsCta: "Sacar boletos",
  /** El botón sale de la app: se avisa antes de tocarlo, no después. */
  externalHint: "Se abre en otra pestaña, fuera de Comunidad Latina.",
} as const;

// ---------------------------------------------------------------------------
// Lectura desde attrs
// ---------------------------------------------------------------------------

export interface EventDetails {
  /** `null` = no lo declaró (evento anterior a esta feature). */
  category: string | null;
  mode: EventMode | null;
  /** Sólo tiene sentido con `mode = 'virtual'`. Ya validado como http(s). */
  onlineUrl: string | null;
  /** Enlace BASE de boletos. Para pintar el botón usar `resolveEventTicketsUrl`. */
  ticketsUrl: string | null;
  capacity: number | null;
  audience: string | null;
  /**
   * `true` = declaró que es gratis · `false` = declaró que se cobra ·
   * `null` = no lo declaró. Tres estados y no dos: `parseEventAttrs` colapsa a
   * booleano porque sólo necesita saber si pintar el chip "Gratis", pero acá,
   * del lado de la escritura, la diferencia importa — un evento viejo sin el
   * campo no es un evento pago.
   */
  free: boolean | null;
}

export function readEventDetails(attrs: unknown): EventDetails {
  const record =
    attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)
      ? (attrs as Record<string, unknown>)
      : {};

  const rawCategory = record[EVENT_CATEGORY_ATTR];
  const rawAudience = record[EVENT_AUDIENCE_ATTR];
  const rawFree = record[EVENT_FREE_ATTR];

  return {
    // Se conserva cualquier string no vacío, no sólo los del catálogo: la
    // taxonomía es lo que la UI conoce, no una restricción sobre el JSONB.
    category: isEventCategory(rawCategory)
      ? rawCategory
      : typeof rawCategory === "string" && rawCategory.trim()
        ? rawCategory.trim()
        : null,
    mode: normalizeEventMode(record[EVENT_MODE_ATTR]),
    onlineUrl: normalizeEventUrl(record[EVENT_ONLINE_URL_ATTR]),
    ticketsUrl: normalizeEventUrl(record[EVENT_TICKETS_URL_ATTR]),
    capacity: normalizeCapacity(record[EVENT_CAPACITY_ATTR]),
    audience: isEventAudience(rawAudience) ? rawAudience : null,
    free: typeof rawFree === "boolean" ? rawFree : null,
  };
}
