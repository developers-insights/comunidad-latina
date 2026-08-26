/**
 * Barril de "Tu zona".
 *
 * Exporta SÓLO lo puro (el saneo de la cookie, la precedencia, el match) y el
 * copy: eso lo pueden importar tanto un Server Component como el selector del
 * navegador. `./server` es `server-only` y `./actions` es un `"use server"`; los
 * dos se importan por su ruta directa a propósito, para que un client component
 * que sólo quería una etiqueta en español no arrastre el cliente de Supabase al
 * bundle. Mismo criterio que el barril de `@/lib/boosts`.
 */

export {
  encodeZonaCookie,
  readZonaCookie,
  sanitizeZona,
  ZONA_COOKIE,
  ZONA_COOKIE_MAX_AGE,
  ZONA_MAX_LEN,
  ZONA_TODAS,
  type ZonaCookie,
} from "./cookie";

export {
  resolverZona,
  TODA_LA_COMUNIDAD,
  zonaVieneDeLaUrl,
  type EntradaZona,
  type ZonaActiva,
  type ZonaOrigen,
} from "./precedencia";

export { zonasCoincidentes, ZONAS_MATCH_MAX } from "./coincidencias";

export { campanaAlcanzaZona, zonasDeCampana, type ZonasDeCampana } from "./campanas";

export { ZONA_COPY } from "./copy";
