import {
  CATEGORY_META,
  CONSENT_VERSION,
  GATED_CATEGORIES,
  categoriesNeedingConsent,
  type ConsentCategory,
  type GatedCategory,
} from "./categories";

/**
 * Persistencia de la decisión de consentimiento.
 *
 * VA EN localStorage Y NO EN UNA COOKIE, a propósito: una cookie viaja en cada
 * petición al servidor, y sería irónico sumar tráfico de cookies justo en la
 * pieza que existe para no tener cookies de más. Hoy nada necesita gatearse en
 * el servidor, así que el navegador alcanza. Guardar la decisión de la persona
 * es "estrictamente necesario" por definición: es lo que evita volver a
 * preguntarle.
 *
 * SE GUARDA CON VERSIÓN Y FECHA porque el RGPD exige poder DEMOSTRAR que hubo
 * consentimiento y cuándo. Sin la fecha, "aceptó" es una afirmación sin prueba.
 */

export const CONSENT_STORAGE_KEY = "cl-consent";

/** 12 meses: el plazo que recomiendan las autoridades europeas para re-preguntar. */
export const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export interface ConsentRecord {
  /** Versión del inventario vigente cuando la persona decidió. */
  version: number;
  /** ISO-8601. La prueba de CUÁNDO se dio el consentimiento. */
  decidedAt: string;
  /** Qué se aceptó, categoría por categoría. */
  granted: Readonly<Partial<Record<GatedCategory, boolean>>>;
}

/**
 * Estado por defecto cuando no hay nada guardado.
 * `activa-por-defecto` arranca en true (está exenta de consentimiento);
 * `requiere-opt-in` arranca en false — SIEMPRE. Un opt-in que nace en true
 * no es un opt-in.
 */
export function defaultGrants(): Record<GatedCategory, boolean> {
  const out = {} as Record<GatedCategory, boolean>;
  for (const category of GATED_CATEGORIES) {
    out[category] = CATEGORY_META[category].policy === "activa-por-defecto";
  }
  return out;
}

// ─── Acceso seguro a localStorage ──────────────────────────────────────────
// Lanza (no devuelve null) en tres casos que pasan de verdad en esta app:
// Safari en privado sin cuota, storage particionado denegado en un iframe, y
// el modo "bloquear todo" de algunos navegadores. Nunca romper la app por esto.

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(CONSENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRaw(value: string): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, value);
  } catch {
    /* Sin storage la decisión no sobrevive a la recarga. Preferimos volver a
       preguntar antes que romper la navegación. */
  }
}

/**
 * Parseo TOLERANTE: cualquier cosa que no sea un registro válido se trata como
 * "no decidió". Un JSON corrupto NUNCA debe leerse como un "sí" — ante la duda,
 * la respuesta segura es no haber consentido.
 */
export function parseConsent(raw: string | null): ConsentRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Partial<ConsentRecord>;
  if (typeof record.version !== "number") return null;
  if (typeof record.decidedAt !== "string") return null;
  if (Number.isNaN(Date.parse(record.decidedAt))) return null;
  if (typeof record.granted !== "object" || record.granted === null) return null;

  // Sólo se conservan las claves conocidas y booleanas: una categoría inventada
  // por alguien editando el storage a mano no entra al sistema.
  const granted: Partial<Record<GatedCategory, boolean>> = {};
  for (const category of GATED_CATEGORIES) {
    const value = (record.granted as Record<string, unknown>)[category];
    if (typeof value === "boolean") granted[category] = value;
  }

  return { version: record.version, decidedAt: record.decidedAt, granted };
}

/**
 * ¿El registro guardado sigue sirviendo?
 * No sirve si es de una versión vieja del inventario (entró algo nuevo que la
 * persona nunca vio) o si pasó el año.
 */
export function isFresh(record: ConsentRecord, now = Date.now()): boolean {
  if (record.version !== CONSENT_VERSION) return false;
  return now - Date.parse(record.decidedAt) < CONSENT_MAX_AGE_MS;
}

/**
 * Caché del snapshot, indexada por el string crudo del storage.
 *
 * NO ES UNA OPTIMIZACIÓN — es un requisito de `useSyncExternalStore`. React
 * compara el snapshot POR IDENTIDAD, y `parseConsent` devuelve un objeto nuevo
 * en cada llamada; sin esto, cada render produce una referencia distinta,
 * React vuelve a renderizar, y el ciclo no termina nunca ("Maximum update
 * depth exceeded").
 *
 * El bug sólo aparecía DESPUÉS de guardar una decisión: sin nada en el storage
 * `readConsent()` devuelve `null`, que sí es estable. O sea que la app
 * funcionaba hasta que alguien tocaba "Aceptar" o "Rechazar", y ahí se caía.
 * Lo encontró `consent-banner.test.tsx`.
 */
let snapshotRaw: string | null = null;
let snapshotValue: ConsentRecord | null = null;
let snapshotPrimed = false;

export function readConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;

  const raw = readRaw();
  if (snapshotPrimed && raw === snapshotRaw) return snapshotValue;

  const parsed = parseConsent(raw);
  snapshotRaw = raw;
  snapshotValue = parsed && isFresh(parsed) ? parsed : null;
  snapshotPrimed = true;
  return snapshotValue;
}

/** Invalida la caché. Necesario cuando el storage cambia por fuera de acá. */
function invalidateSnapshot(): void {
  snapshotPrimed = false;
}

/** Los permisos vigentes, con los defaults aplicados a lo que no se decidió. */
export function resolveGrants(
  record: ConsentRecord | null,
): Record<GatedCategory, boolean> {
  const grants = defaultGrants();
  if (!record) return grants;
  for (const category of GATED_CATEGORIES) {
    const value = record.granted[category];
    if (typeof value === "boolean") grants[category] = value;
  }
  return grants;
}

/**
 * ¿Hay que preguntarle a esta persona?
 * Sólo si existe alguna categoría de opt-in CON TRAZADORES VIVOS y todavía no
 * hay una decisión fresca. Hoy `categoriesNeedingConsent()` devuelve vacío, así
 * que esto es `false` para todo el mundo y no se muestra ningún banner.
 */
export function needsDecision(record: ConsentRecord | null = readConsent()): boolean {
  if (categoriesNeedingConsent().length === 0) return false;
  return record === null;
}

// ─── Escritura + notificación ──────────────────────────────────────────────

const listeners = new Set<() => void>();

function emit(): void {
  // Siempre invalidar ANTES de avisar: si los suscriptores leyeran el snapshot
  // viejo, la UI mostraría la decisión anterior a la que se acaba de tomar.
  invalidateSnapshot();
  for (const listener of listeners) listener();
}

/**
 * Avisar de un cambio en el storage local que NO pasó por este módulo — hoy,
 * el botón de "borrar lo de este teléfono". Sin esto la lista de la pantalla de
 * privacidad seguiría mostrando claves ya borradas: `useSyncExternalStore` sólo
 * vuelve a leer cuando alguien lo despierta.
 */
export function notifyConsentChange(): void {
  emit();
}

/** Guarda la decisión completa y avisa a la UI. */
export function saveConsent(
  grants: Readonly<Partial<Record<GatedCategory, boolean>>>,
): ConsentRecord {
  const granted = { ...resolveGrants(readConsent()), ...grants };
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
    granted,
  };
  writeRaw(JSON.stringify(record));
  emit();
  return record;
}

/** Acepta todo lo que se puede aceptar. */
export function acceptAll(): ConsentRecord {
  const grants = {} as Record<GatedCategory, boolean>;
  for (const category of GATED_CATEGORIES) grants[category] = true;
  return saveConsent(grants);
}

/**
 * Rechaza todo lo rechazable. Es la contraparte EXACTA de `acceptAll`: mismo
 * costo, un solo clic. Que rechazar sea tan fácil como aceptar no es cortesía,
 * es lo que exige el RGPD y lo que multan las autoridades europeas.
 */
export function rejectAll(): ConsentRecord {
  const grants = {} as Record<GatedCategory, boolean>;
  for (const category of GATED_CATEGORIES) {
    grants[category] = CATEGORY_META[category].policy === "activa-por-defecto";
  }
  return saveConsent(grants);
}

/** Borra la decisión: la próxima visita vuelve a preguntar. */
export function revokeConsent(): void {
  try {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    /* nada que hacer */
  }
  emit();
}

/**
 * Suscripción para `useSyncExternalStore`. Incluye el evento `storage` para
 * que aceptar en una pestaña se refleje en las otras: dos pestañas con
 * permisos distintos serían dos verdades sobre lo mismo.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CONSENT_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Sólo para tests: deja el módulo sin suscriptores ni caché entre casos. */
export function __resetListeners(): void {
  listeners.clear();
  invalidateSnapshot();
}

export type { ConsentCategory };
