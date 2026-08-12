/**
 * Punto de entrada del módulo Comunidad (migración 0096).
 *
 * Todo lo de acá es PURO: tipos, copy y lógica sin I/O. Las lecturas viven en
 * `src/app/(app)/comunidad/queries.ts` y las escrituras en `actions.ts` — así
 * este paquete lo pueden importar por igual los componentes de cliente, los
 * Server Components y los tests.
 */

export {
  LOST_FOUND_AREA_MAX,
  LOST_FOUND_AREA_MIN,
  LOST_FOUND_CATEGORIES,
  LOST_FOUND_DESCRIPTION_MAX,
  LOST_FOUND_DESCRIPTION_MIN,
  LOST_FOUND_KIND,
  LOST_FOUND_MAX_PHOTOS,
  LOST_FOUND_TITLE_MAX,
  LOST_FOUND_TITLE_MIN,
  LOST_FOUND_TYPES,
  RESOURCE_COLUMNS,
  RESOURCE_TOPICS,
  supabaseSinTiparComunidad,
  type CommunityResource,
  type LostFoundAttrs,
  type LostFoundCase,
  type LostFoundCategory,
  type LostFoundType,
  type ResourceGroup,
  type ResourceRow,
  type ResourceSource,
  type ResourceTopic,
} from "./types";

export {
  COMUNIDAD_COPY,
  LOST_FOUND_CATEGORY_LABEL,
  LOST_FOUND_TYPE_LABEL,
  RESOURCE_TOPIC_HINT,
  RESOURCE_TOPIC_LABEL,
} from "./copy";

export {
  LOST_FOUND_MAX_AGE_DAYS,
  buildLostFoundAttrs,
  isAcceptableHappenedOn,
  isPlainDate,
  isResolvedCase,
  parseLostFoundAttrs,
  sanitizeAreaFilter,
  sortCasesOpenFirst,
  toLostFoundCategory,
  toLostFoundType,
} from "./perdidos";

export {
  groupResourcesByTopic,
  isSafeHttpUrl,
  mapsHref,
  telHref,
  toCommunityResource,
  toResourceGroups,
} from "./recursos";
