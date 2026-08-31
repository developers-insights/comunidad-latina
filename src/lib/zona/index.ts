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

export {
  barrioMasCercano,
  CENTROIDES,
  centroideDeZona,
  distanciaEnMillas,
  esCoordenadaValida,
  RADIO_TIERRA_MILLAS,
  SNAP_MAX_MILLAS,
  zonasEnRadio,
  type BarrioCercano,
  type Centroide,
  type Coordenada,
} from "./centroides";

export {
  encodeRadioCookie,
  RADIO_COOKIE,
  RADIO_COOKIE_MAX_AGE,
  RADIO_DEFAULT,
  RADIO_SOLO_ZONA,
  RADIOS_MILLAS,
  radioAplicado,
  readRadioCookie,
  sanitizeRadio,
  type RadioCookie,
  type RadioMillas,
} from "./radio";

export { campanaAlcanzaZona, zonasDeCampana, type ZonasDeCampana } from "./campanas";

export { ZONA_COPY } from "./copy";
