/**
 * API de consentimiento. Entrada única — importar siempre desde
 * `@/lib/consent`, nunca desde los archivos sueltos, para que el día que la
 * implementación cambie no haya que tocar veinte call sites.
 */

export {
  CATEGORY_META,
  CONSENT_CATEGORIES,
  CONSENT_VERSION,
  GATED_CATEGORIES,
  OPT_IN_CATEGORIES,
  TRACKERS,
  categoriesNeedingConsent,
  isActive,
  trackersOf,
  type CategoryMeta,
  type ConsentCategory,
  type ConsentPolicy,
  type GatedCategory,
  type TrackerEntry,
  type TrackerKind,
} from "./categories";

export {
  CONSENT_MAX_AGE_MS,
  CONSENT_STORAGE_KEY,
  acceptAll,
  defaultGrants,
  isFresh,
  needsDecision,
  parseConsent,
  readConsent,
  rejectAll,
  resolveGrants,
  revokeConsent,
  saveConsent,
  subscribe,
  type ConsentRecord,
} from "./store";

export { SENTRY_CONSENT_CATEGORY, categoryLabel, hasConsent, whenConsented } from "./gate";

export {
  clearCachedMedia,
  clearLocalData,
  isClearable,
  listLocalData,
  type LocalEntry,
} from "./local-data";

export { useConsent, type UseConsent } from "./use-consent";
