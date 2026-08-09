import { DEFAULT_TIME_ZONE } from "@/lib/utils";

/**
 * Zonas horarias que el selector ofrece.
 *
 * ── EL BUG QUE ORIGINA ESTE ARCHIVO ──────────────────────────────────────────
 * `DEFAULT_TIME_ZONE` es `America/New_York` para todo el repo. Alguien en Los
 * Ángeles que publica a las 22:00 ve su publicación fechada AL DÍA SIGUIENTE:
 * el instante es correcto y la fecha que lee es falsa. El público está repartido
 * entre NY, NJ, Miami, Houston, Chicago y LA, así que ninguna zona única sirve —
 * la zona es un atributo de la PERSONA (por eso `profiles.timezone` en 0067).
 *
 * ── POR QUÉ UNA LISTA CURADA Y NO LAS ~600 DE IANA ───────────────────────────
 * `Intl.supportedValuesOf("timeZone")` devuelve unas 600 entradas con nombres
 * que no significan nada para quien las mira ("America/Indiana/Tell_City"). Este
 * público no está eligiendo una zona horaria: está diciendo en qué ciudad vive.
 * La lista son las ciudades donde de verdad está la diáspora, más los países de
 * origen para quien todavía no se mudó, y cada una lleva el nombre de la CIUDAD
 * adelante — que es lo que la persona reconoce.
 *
 * ── LA ZONA NUNCA SE ESCRIBE A MANO ──────────────────────────────────────────
 * `America/New_York` aparece exactamente una vez en el repo, en `lib/utils.ts`,
 * y acá se importa. `src/test/time-zone-single-source.test.ts` falla si alguien
 * la vuelve a tipear.
 */

export interface TimeZoneOption {
  /** Identificador IANA — lo que se guarda en `profiles.timezone`. */
  id: string;
  /** Ciudad primero: es lo que la persona busca con la vista. */
  label: string;
  /** Agrupador del `<optgroup>`. */
  group: string;
}

const ESTE = "Costa Este";
const CENTRO = "Centro y Montaña";
const OESTE = "Costa Oeste";
const CARIBE = "Caribe y Centroamérica";
const SUR = "Sudamérica";

/**
 * `DEFAULT_TIME_ZONE` entra como la opción de Nueva York en vez de repetir el
 * literal: es la misma zona, y duplicarla es exactamente lo que el test de
 * regresión existe para impedir.
 */
export const TIME_ZONES: readonly TimeZoneOption[] = [
  { id: DEFAULT_TIME_ZONE, label: "Nueva York · Nueva Jersey", group: ESTE },
  { id: "America/Detroit", label: "Detroit", group: ESTE },
  { id: "America/Chicago", label: "Chicago · Houston · Dallas", group: CENTRO },
  { id: "America/Denver", label: "Denver", group: CENTRO },
  { id: "America/Phoenix", label: "Phoenix", group: CENTRO },
  { id: "America/Los_Angeles", label: "Los Ángeles · San Francisco", group: OESTE },
  { id: "America/Anchorage", label: "Anchorage", group: OESTE },
  { id: "Pacific/Honolulu", label: "Honolulu", group: OESTE },
  { id: "America/Puerto_Rico", label: "San Juan (Puerto Rico)", group: CARIBE },
  { id: "America/Santo_Domingo", label: "Santo Domingo", group: CARIBE },
  { id: "America/Havana", label: "La Habana", group: CARIBE },
  { id: "America/Port-au-Prince", label: "Puerto Príncipe", group: CARIBE },
  { id: "America/Mexico_City", label: "Ciudad de México", group: CARIBE },
  { id: "America/Guatemala", label: "Guatemala · San Salvador · Tegucigalpa", group: CARIBE },
  { id: "America/Managua", label: "Managua", group: CARIBE },
  { id: "America/Costa_Rica", label: "San José (Costa Rica)", group: CARIBE },
  { id: "America/Panama", label: "Ciudad de Panamá", group: CARIBE },
  { id: "America/Bogota", label: "Bogotá", group: SUR },
  { id: "America/Caracas", label: "Caracas", group: SUR },
  { id: "America/Guayaquil", label: "Quito · Guayaquil", group: SUR },
  { id: "America/Lima", label: "Lima", group: SUR },
  { id: "America/La_Paz", label: "La Paz", group: SUR },
  { id: "America/Asuncion", label: "Asunción", group: SUR },
  { id: "America/Santiago", label: "Santiago de Chile", group: SUR },
  { id: "America/Argentina/Buenos_Aires", label: "Buenos Aires", group: SUR },
  { id: "America/Montevideo", label: "Montevideo", group: SUR },
  { id: "America/Sao_Paulo", label: "São Paulo", group: SUR },
  { id: "Europe/Madrid", label: "Madrid", group: SUR },
] as const;

/** El orden de los `<optgroup>`, que no es el orden alfabético de los grupos. */
export const TIME_ZONE_GROUPS: readonly string[] = [ESTE, CENTRO, OESTE, CARIBE, SUR];

const KNOWN = new Set(TIME_ZONES.map((z) => z.id));

/** ¿Está en el catálogo? Es lo que valida el servidor antes de escribir. */
export function isKnownTimeZone(value: string | null | undefined): boolean {
  return typeof value === "string" && KNOWN.has(value);
}

export function timeZoneLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return TIME_ZONES.find((z) => z.id === id)?.label ?? id;
}

/**
 * La zona del navegador, o `null` donde no hay navegador (SSR, tests).
 *
 * Es la que se ofrece preseleccionada la primera vez: acertarle a la zona de
 * alguien sin preguntarle es la diferencia entre un ajuste que se completa y uno
 * que queda vacío para siempre.
 */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * La zona del navegador PERO acotada al catálogo. Alguien en `America/Indiana/
 * Vincennes` no encuentra su opción en la lista; lo honesto es no preseleccionar
 * nada antes que preseleccionar la zona equivocada.
 */
export function suggestedTimeZone(): string | null {
  const zone = browserTimeZone();
  return zone && KNOWN.has(zone) ? zone : null;
}
