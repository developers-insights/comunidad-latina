/**
 * Barril del módulo MONETIZACIÓN.
 *
 * Exporta SÓLO lo puro (`tier` y `copy`), que es lo que pueden importar tanto
 * un Server Component como un client component. `actions.ts` ("use server") y
 * `stats.ts` ("server-only") se importan por su ruta directa a propósito: si
 * entraran acá, cualquier client component que quisiera una etiqueta de botón
 * arrastraría el cliente de Supabase al bundle del navegador — o directamente
 * rompería el build.
 */

export { COPY as MONETIZATION_COPY } from "./copy";
export {
  CTA_COLUMN,
  CTA_COLUMNS,
  CTA_KINDS,
  CTA_VALUE_KIND,
  EXTERNAL_CTA_KINDS,
  FREE_MAX_PHOTOS,
  LISTING_KINDS,
  LISTING_TIERS,
  MODULE_CTAS,
  PREMIUM_MAX_PHOTOS,
  TIER_LIMITS,
  canUseActionButtons,
  checkListingVideo,
  checkPhotoCount,
  externalCtasFor,
  isExternalCtaKind,
  isPremium,
  isRecommendedFeedEligible,
  limitsFor,
  maxPhotosFor,
  maxVideoSecondsFor,
  parseCtaKind,
  parseListingKind,
  parseListingTier,
  visibleCtasFor,
  type CtaKind,
  type CtaValueKind,
  type ExternalCtaKind,
  type ListingKind,
  type ListingTier,
  type ListingVideoCheck,
  type PhotoCheck,
  type TierLimits,
} from "./tier";
