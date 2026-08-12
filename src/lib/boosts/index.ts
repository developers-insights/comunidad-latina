/**
 * Barril del módulo IMPULSOS.
 *
 * Exporta SÓLO `scope`, que es puro y lo puede importar tanto un Server
 * Component como el selector de alcance del navegador. `select.ts` es
 * `server-only` (usa el cliente admin) y se importa por su ruta directa a
 * propósito: si entrara acá, un client component que sólo quería una etiqueta
 * en español arrastraría la service-role key al bundle — o directamente
 * rompería el build. Mismo criterio que los barriles de `pricing` y
 * `monetization`.
 */

export {
  BOOST_SCOPES,
  BOOST_SCOPE_COPY,
  BOOST_SCOPE_IDS,
  DEFAULT_BOOST_SCOPE,
  boostIsOfferedOutside,
  boostReachesViewer,
  normalizeBoostScope,
  normalizeGeoLabel,
  parseBoostScope,
  readBoostScopeTarget,
  sameCountryLabel,
  sameZoneLabel,
  type BoostScope,
  type BoostScopeRow,
  type BoostScopeTarget,
  type ViewerGeo,
} from "./scope";
