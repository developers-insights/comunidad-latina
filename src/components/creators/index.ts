// Barrel del Creator Marketplace. Los módulos puros (contract-machine, money,
// categories, helpers, copy) no arrastran runtime de cliente; los componentes
// interactivos son client islands.

export { COPY } from "./copy";
export {
  GIG_CATEGORIES,
  gigCategoryMeta,
  isGigCategory,
  type GigCategory,
  type GigCategoryMeta,
} from "./categories";
export {
  URGENT_DEADLINE_DAYS,
  creatorPhotoUrl,
  firstPortfolioUrl,
  formatRating,
  isUrgentDeadline,
  parseGigAttrs,
  type GigAttrs,
} from "./helpers";
export {
  allowedActions,
  contractStepIndex,
  CONTRACT_STEPS,
  findTransition,
  isTerminalStatus,
  roleOf,
  TRANSITIONS,
  type ContractAction,
  type ContractRole,
  type ContractStatus,
  type TransitionRule,
} from "./contract-machine";
export {
  contractBreakdown,
  dollarsToCents,
  formatCents,
  type ContractBreakdown,
} from "./money";
export {
  REQUIREMENT_IDS,
  REQUIREMENT_TARGETS,
  accountAgeInDays,
  computeCreatorRequirements,
  formatRequirementGap,
  formatRequirementNumber,
  formatRequirementValue,
  type CreatorRequirementsInput,
  type CreatorRequirementsResult,
  type Requirement,
  type RequirementId,
  type RequirementUnit,
} from "./requirements";

export { CreatorsNav, type CreatorsSection } from "./creators-nav";
export { GigCard, type GigCardModel } from "./gig-card";
export { CreatorCard, type CreatorCardModel } from "./creator-card";
export { RatingStars } from "./rating-stars";
export { DemoSeal } from "./demo-seal";
export { ContractStepper, ContractStatusBadge } from "./contract-stepper";
export { ContractBreakdown as ContractBreakdownCard } from "./contract-breakdown";
export { CreatorRequirementsCard } from "./requirements-card";
/** Elegibilidad configurable por tenant (0064) — panel + solicitud + términos. */
export { CreatorEligibilityChecklist } from "./eligibility-checklist";
export { JobCodeSearch } from "./job-code-search";
export { SocialAudience } from "./social-audience";
export { GigListSkeleton, CreatorListSkeleton, ContractsListSkeleton } from "./skeletons";

export { ApplySheet } from "./apply-sheet";
export { ApplicationRow, WithdrawButton, type ApplicationCreator } from "./application-row";
export { ContractForm } from "./contract-form";
export { ContractActions } from "./contract-actions";
export { ReviewForm } from "./review-form";
export { CreatorProfileForm, type CreatorProfileInitial } from "./creator-profile-form";
export { GigPublishForm } from "./gig-publish-form";
