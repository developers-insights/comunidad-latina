/**
 * Punto de entrada del módulo Comunidad (migración 0096).
 *
 * Todo lo de acá es PURO: tipos, copy y lógica sin I/O. Las lecturas viven en
 * `src/app/(app)/comunidad/queries.ts` y las escrituras en `actions.ts` — así
 * este paquete lo pueden importar por igual los componentes de cliente, los
 * Server Components y los tests.
 */

export {
  HELP_AREA_MAX,
  HELP_AREA_MIN,
  HELP_AVAILABILITY_MAX,
  HELP_BODY_MAX,
  HELP_BODY_MIN,
  HELP_DIRECTIONS,
  HELP_DIRECTION_DEFAULT,
  HELP_MAX_OPEN,
  HELP_NOTICE_COLUMNS,
  HELP_ORG_MAX,
  HELP_REPLY_COLUMNS,
  HELP_REPLY_MAX,
  HELP_REPLY_MIN,
  HELP_REPLY_STATUSES,
  HELP_REVIEW_NOTE_MAX,
  HELP_REVIEW_NOTE_MIN,
  HELP_STATUSES,
  HELP_TITLE_MAX,
  HELP_TITLE_MIN,
  HELP_TOPICS,
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
  type HelpDirection,
  type HelpNotice,
  type HelpNoticeRow,
  type HelpReply,
  type HelpReplyRow,
  type HelpReplyStatus,
  type HelpStatus,
  type HelpTopic,
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
  HELP_LANGUAGES,
  HELP_STATUS_HINT,
  HELP_STATUS_LABEL,
  HELP_TOPIC_HINT,
  HELP_TOPIC_LABEL,
  LOST_FOUND_CATEGORY_LABEL,
  LOST_FOUND_TYPE_LABEL,
  RESOURCE_TOPIC_HINT,
  RESOURCE_TOPIC_LABEL,
} from "./copy";

export {
  HELP_OPEN_STATUSES,
  detectarDatoDeContacto,
  esPedidoAbierto,
  isHelpDirection,
  isHelpReplyStatus,
  isHelpStatus,
  isHelpTopic,
  primerDatoDeContacto,
  puedeEditarContenido,
  puedeTransicionar,
  puedeTransicionarRespuesta,
  sanitizeSearchFilter,
  toHelpNotice,
  toHelpReply,
  transicionesPosibles,
  type DatoDeContacto,
  type HelpActor,
  type HelpNoticeContext,
  type HelpReplyContext,
} from "./pedir-ayuda";

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
  isResourceTopic,
  isSafeHttpUrl,
  mapsHref,
  telHref,
  toCommunityResource,
  toResourceGroups,
} from "./recursos";
