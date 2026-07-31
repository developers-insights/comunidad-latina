/**
 * GRATIS vs PREMIUM — el ÚNICO lugar donde viven los topes y los botones.
 *
 * Es la parte del producto que COBRA: la diferencia entre `free` y `premium`
 * es, literalmente, la factura. Por eso los números viven acá y no sueltos por
 * la app — un tope duplicado es un tope que se va a separar, y el día que se
 * separe alguien va a estar pagando por algo que ya tenía gratis (o al revés).
 *
 * QUIÉN VALIDA QUÉ (las tres capas, en orden de autoridad):
 *
 *   1. LA BASE (0048) es la última línea y la única infalsificable:
 *      `listings_cta_premium_only` garantiza que en `tier='free'` los 7 botones
 *      externos son NULL, y `app.protect_listing_counters()` impide que el
 *      dueño se suba de tier desde el formulario. Ni PostgREST ni una server
 *      action con bug pueden violarlas.
 *   2. EL SERVIDOR (server actions) vuelve a preguntar acá antes de escribir.
 *      No porque desconfíe de la base, sino porque un error de constraint es un
 *      500 sin copy: el rechazo tiene que llegar como una frase amable.
 *   3. EL FORMULARIO usa este mismo módulo para no dejar que la persona llegue
 *      hasta el final y recién ahí se entere. Es UX, no seguridad.
 *
 * Que las tres capas lean el MISMO archivo es todo el punto. Un tope que sólo
 * vive en el cliente no es un tope: es una sugerencia.
 *
 * MÓDULO PURO a propósito: sin DOM, sin Supabase, sin React — igual que
 * `src/lib/media/video-policy.ts`, del que este archivo CONSUME los segundos en
 * vez de volver a escribirlos.
 */

import {
  FEED_PREVIEW_MAX_SECONDS,
  PREMIUM_DETAIL_MAX_SECONDS,
  normalizeDeclaredDuration,
} from "@/lib/media/video-policy";

// ---------------------------------------------------------------------------
// El tier
// ---------------------------------------------------------------------------

/** Espeja `listings.tier` (CHECK de la 0048). */
export const LISTING_TIERS = ["free", "premium"] as const;
export type ListingTier = (typeof LISTING_TIERS)[number];

/**
 * Un valor desconocido NO es premium. El default cae del lado restrictivo a
 * propósito: si la columna todavía no llegó, si la fila vino de un select que
 * no la pidió, o si alguien manda basura, la respuesta correcta es "gratis" —
 * regalar premium por un `null` es regalar la parte que se cobra.
 */
export function parseListingTier(raw: unknown): ListingTier {
  return raw === "premium" ? "premium" : "free";
}

export function isPremium(raw: unknown): boolean {
  return parseListingTier(raw) === "premium";
}

// ---------------------------------------------------------------------------
// Los topes
// ---------------------------------------------------------------------------

/** Publicación gratuita: hasta 5 fotos (spec nº3). */
export const FREE_MAX_PHOTOS = 5;

/** Publicación premium: hasta 20 fotos (spec nº3). */
export const PREMIUM_MAX_PHOTOS = 20;

export interface TierLimits {
  /** Cuántas fotos entran en la publicación. */
  maxPhotos: number;
  /**
   * Segundos del único video de la publicación.
   *
   * Los dos números salen de `video-policy.ts` y NO se re-declaran acá: 59 s
   * (lo que el feed reproduce) para gratis, 300 s (el video completo del
   * detalle premium) para premium. El conflicto nº3 del feedback ya está
   * resuelto allá; acá sólo se elige cuál aplica.
   */
  maxVideoSeconds: number;
  /** ¿Puede tener botones externos (Llamar, WhatsApp, Sitio web…)? */
  actionButtons: boolean;
  /** ¿Entra al News Feed principal recomendado? */
  recommendedFeed: boolean;
  /** ¿Sube en el orden de las búsquedas? */
  searchPriority: boolean;
}

export const TIER_LIMITS: Record<ListingTier, TierLimits> = {
  free: {
    maxPhotos: FREE_MAX_PHOTOS,
    maxVideoSeconds: FEED_PREVIEW_MAX_SECONDS,
    actionButtons: false,
    recommendedFeed: false,
    searchPriority: false,
  },
  premium: {
    maxPhotos: PREMIUM_MAX_PHOTOS,
    maxVideoSeconds: PREMIUM_DETAIL_MAX_SECONDS,
    actionButtons: true,
    recommendedFeed: true,
    searchPriority: true,
  },
};

export function limitsFor(tier: unknown): TierLimits {
  return TIER_LIMITS[parseListingTier(tier)];
}

export function maxPhotosFor(tier: unknown): number {
  return limitsFor(tier).maxPhotos;
}

export function maxVideoSecondsFor(tier: unknown): number {
  return limitsFor(tier).maxVideoSeconds;
}

/** Botones externos: la regla que la base garantiza con un CHECK. */
export function canUseActionButtons(tier: unknown): boolean {
  return limitsFor(tier).actionButtons;
}

/**
 * ¿Este aviso entra al News Feed principal RECOMENDADO?
 *
 * Ojo con lo que esta función NO decide: el aviso gratuito sigue apareciendo en
 * el perfil de quien lo publicó, en el feed de sus seguidores, en las búsquedas
 * y en el feed de su módulo. Lo único que se reserva a premium es el empujón
 * que la app da sin que nadie lo pida. Es alcance, no permisos — el aislamiento
 * real lo sigue dando la RLS.
 */
export function isRecommendedFeedEligible(tier: unknown): boolean {
  return limitsFor(tier).recommendedFeed;
}

// ---------------------------------------------------------------------------
// Verificación de fotos
// ---------------------------------------------------------------------------

export type PhotoRejection = "too-many";

export type PhotoCheck =
  | { ok: true; count: number }
  | { ok: false; reason: PhotoRejection; max: number; count: number };

/**
 * ¿Entran estas fotos en una publicación de este tier? La llaman el formulario
 * (para avisar antes de subir un byte) y la server action (para decidir si
 * escribe). La misma pregunta, al mismo módulo.
 *
 * Un array vacío es VÁLIDO: publicar sin fotos siempre se pudo.
 */
export function checkPhotoCount(tier: unknown, count: number): PhotoCheck {
  const max = maxPhotosFor(tier);
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (safeCount > max) {
    return { ok: false, reason: "too-many", max, count: safeCount };
  }
  return { ok: true, count: safeCount };
}

// ---------------------------------------------------------------------------
// Verificación del video de la publicación
// ---------------------------------------------------------------------------

export type ListingVideoRejection = "unknown" | "too-long";

export type ListingVideoCheck =
  | { ok: true; seconds: number }
  | { ok: false; reason: ListingVideoRejection; max: number };

/**
 * ¿Se puede publicar este video en un aviso de este tier?
 *
 * Se apoya en `normalizeDeclaredDuration` de video-policy (redondeo HACIA
 * ARRIBA, para que el redondeo no sea la forma barata de esquivar el tope) y
 * mantiene su criterio: duración DESCONOCIDA no es "corta", se rechaza.
 */
export function checkListingVideo(tier: unknown, rawSeconds: unknown): ListingVideoCheck {
  const max = maxVideoSecondsFor(tier);
  const seconds = normalizeDeclaredDuration(rawSeconds);
  if (seconds === null) return { ok: false, reason: "unknown", max };
  if (seconds > max) return { ok: false, reason: "too-long", max };
  return { ok: true, seconds };
}

// ---------------------------------------------------------------------------
// Botones de acción
// ---------------------------------------------------------------------------

/**
 * Espeja el CHECK de `cta_clicks.cta_kind` (0048) y el parámetro de
 * `public.record_cta_click`. Si estas dos listas se separan, la RPC empieza a
 * tirar INVALID_CTA_KIND y el clic se pierde en silencio.
 */
export const CTA_KINDS = [
  "phone",
  "whatsapp",
  "website",
  "purchase",
  "tickets",
  "booking",
  "directions",
  "chat",
] as const;
export type CtaKind = (typeof CTA_KINDS)[number];

/** Los 7 botones EXTERNOS (los que la base reserva a premium). */
export const EXTERNAL_CTA_KINDS = [
  "phone",
  "whatsapp",
  "website",
  "purchase",
  "tickets",
  "booking",
  "directions",
] as const;
export type ExternalCtaKind = (typeof EXTERNAL_CTA_KINDS)[number];

export function parseCtaKind(raw: unknown): CtaKind | null {
  return CTA_KINDS.includes(raw as CtaKind) ? (raw as CtaKind) : null;
}

export function isExternalCtaKind(kind: CtaKind): kind is ExternalCtaKind {
  return kind !== "chat";
}

/**
 * Botón externo → columna de `listings` (0048).
 *
 * `directions` apunta a `cta_address` y no a un par lat/lng: la migración lo
 * explica y no se relaja acá. El link a mapas lo arma la app con ese texto.
 */
export const CTA_COLUMN: Record<ExternalCtaKind, string> = {
  phone: "cta_phone",
  whatsapp: "cta_whatsapp",
  website: "cta_website",
  purchase: "cta_purchase_url",
  tickets: "cta_tickets_url",
  booking: "cta_booking_url",
  directions: "cta_address",
};

/** Las 7 columnas, para el select del detalle y para la limpieza del downgrade. */
export const CTA_COLUMNS: readonly string[] = EXTERNAL_CTA_KINDS.map(
  (kind) => CTA_COLUMN[kind],
);

/**
 * Cómo se carga cada botón. Determina el input del formulario Y la validación:
 * `url` pasa SIEMPRE por `safeExternalHref` (que clasifica por origen resuelto,
 * no por prefijo de string), `phone` por el formato laxo que la base acepta, y
 * `text` es la dirección que el comercio eligió publicar.
 */
export type CtaValueKind = "phone" | "url" | "text";

export const CTA_VALUE_KIND: Record<ExternalCtaKind, CtaValueKind> = {
  phone: "phone",
  whatsapp: "phone",
  website: "url",
  purchase: "url",
  tickets: "url",
  booking: "url",
  directions: "text",
};

// ---------------------------------------------------------------------------
// Botones POR MÓDULO — los de la spec, no una lista genérica
// ---------------------------------------------------------------------------

/** Espeja `listings.kind` (0004 + 0024). */
export const LISTING_KINDS = [
  "property",
  "business",
  "professional",
  "event",
  "job",
  "product",
  "creator_gig",
] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export function parseListingKind(raw: unknown): ListingKind | null {
  return LISTING_KINDS.includes(raw as ListingKind) ? (raw as ListingKind) : null;
}

/**
 * Qué botones ofrece cada módulo, EN ORDEN (el orden es la jerarquía: el
 * primero es la acción que ese vertical espera de verdad).
 *
 * Sale literal de la spec nº3, y por eso NO es una lista genérica repetida
 * cinco veces: un evento no se "llama por teléfono", se le compran boletos; una
 * propiedad no tiene "comprar", tiene "cómo llegar". Ofrecer los siete en todos
 * lados sería más fácil de programar y peor de usar.
 *
 * `job` y `creator_gig` quedan sin botones externos a propósito: los dos tienen
 * su propio flujo (postulación / propuesta de colaboración) y meterles un
 * "Llamar" al lado sería empujar la conversación fuera del canal que los
 * protege. El chat interno, como en todos, sigue estando.
 */
export const MODULE_CTAS: Record<ListingKind, readonly ExternalCtaKind[]> = {
  property: ["phone", "whatsapp", "directions"],
  event: ["tickets", "directions"],
  product: ["purchase", "website"],
  business: ["phone", "whatsapp", "website", "directions"],
  professional: ["booking", "phone", "whatsapp"],
  job: [],
  creator_gig: [],
};

/**
 * Botones externos que ese módulo puede ofrecer. Un `kind` desconocido devuelve
 * lista vacía: no se inventan botones para un vertical que todavía no existe.
 */
export function externalCtasFor(kind: unknown): readonly ExternalCtaKind[] {
  const parsed = parseListingKind(kind);
  return parsed ? MODULE_CTAS[parsed] : [];
}

/**
 * Los botones que se RENDERIZAN para un aviso concreto: los externos que su
 * módulo ofrece Y que su tier habilita Y que además tienen valor cargado, más
 * el chat interno SIEMPRE al final.
 *
 * El chat va siempre porque es el contrato del producto: en gratis es el único
 * contacto, y en premium sigue estando al lado de los botones pagos — nadie
 * pierde el canal protegido por pagar.
 */
export function visibleCtasFor(input: {
  kind: unknown;
  tier: unknown;
  /** Valores cargados por botón (los que la fila trae en sus columnas). */
  values?: Partial<Record<ExternalCtaKind, string | null | undefined>>;
}): CtaKind[] {
  const visible: CtaKind[] = [];
  if (canUseActionButtons(input.tier)) {
    for (const kind of externalCtasFor(input.kind)) {
      const value = input.values?.[kind];
      if (typeof value === "string" && value.trim().length > 0) visible.push(kind);
    }
  }
  visible.push("chat");
  return visible;
}
