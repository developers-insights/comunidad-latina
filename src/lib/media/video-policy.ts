/**
 * POLÍTICA DE DURACIÓN DE VIDEO — el ÚNICO lugar donde viven los cuatro topes.
 *
 * Los números son cuatro y aplican a superficies distintas; si se separan, se
 * contradicen (fue el conflicto nº3 del feedback consolidado del 2026-07-30):
 *
 *   ·  90 s → tope de TODO video orgánico. Es el contrato de Videos Cortos y lo
 *             sostiene la base (`posts_short_video_duration` /
 *             `posts_short_feed_duration`, migración 0046).
 *   ·  59 s → cuánto se REPRODUCE en la tarjeta del feed. No es un tope de
 *             publicación: es vista previa. El video completo se abre desde la
 *             publicación.
 *   · 300 s → video completo de una publicación premium, reproducido en el
 *             detalle (5 minutos, spec nº3).
 *   · 600 s → video publicitario, dentro de su anuncio (10 minutos, spec nº4).
 *             Nunca entra al scroll de Videos Cortos.
 *
 * Módulo PURO a propósito: sin DOM, sin Supabase, sin React. Lo importan el
 * composer (navegador), la server action (servidor) y el reel — los tres tienen
 * que estar de acuerdo, y para eso tienen que leer del mismo archivo.
 *
 * LO QUE ESTE MÓDULO NO PUEDE HACER: medir el archivo. `duration_seconds` es un
 * valor DECLARADO (lo dice la propia migración 0046). Quien mide es el navegador
 * —`readVideoDurationSeconds`, con la metadata del `<video>` antes de subir— y
 * quien vuelve a revisar el número declarado es la server action. La base es la
 * última línea, no la primera.
 */

// ---------------------------------------------------------------------------
// Los cuatro números
// ---------------------------------------------------------------------------

/** Tope duro de un video orgánico (Videos Cortos). Espeja el CHECK de la 0046. */
export const SHORT_VIDEO_MAX_SECONDS = 90;

/** Vista previa en la tarjeta del feed. El completo se abre desde el post. */
export const FEED_PREVIEW_MAX_SECONDS = 59;

/** Video completo de una publicación premium, en el detalle (spec nº3). */
export const PREMIUM_DETAIL_MAX_SECONDS = 300;

/** Video publicitario, dentro de su anuncio (spec nº4). Fuera del scroll. */
export const ADVERTISING_VIDEO_MAX_SECONDS = 600;

/**
 * EL MENSAJE DEL TOPE, PALABRA POR PALABRA (spec nº4). Vive acá y no en un
 * archivo de copy para que exista UNA sola vez: el navegador y el servidor
 * rechazan por la misma regla y tienen que decir exactamente lo mismo.
 * Hay un test que ancla el texto carácter por carácter.
 */
export const SHORT_VIDEO_LIMIT_MESSAGE =
  "Los Videos Cortos pueden durar un máximo de 90 segundos. Para publicar un video más largo, debe formar parte de una publicidad pagada.";

// ---------------------------------------------------------------------------
// Tipos de video (posts.video_type, 0046)
// ---------------------------------------------------------------------------

export const VIDEO_TYPES = ["short_video", "advertising_video"] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];

export function parseVideoType(raw: unknown): VideoType | null {
  return VIDEO_TYPES.includes(raw as VideoType) ? (raw as VideoType) : null;
}

/** Tope de publicación del tipo. Es el número que la base va a verificar. */
export function maxDurationFor(type: VideoType): number {
  return type === "advertising_video"
    ? ADVERTISING_VIDEO_MAX_SECONDS
    : SHORT_VIDEO_MAX_SECONDS;
}

// ---------------------------------------------------------------------------
// Categorías (posts.video_category, 0046) — catálogo CERRADO
// ---------------------------------------------------------------------------

export const VIDEO_CATEGORIES = [
  "comida",
  "musica",
  "eventos",
  "propiedades",
  "negocios",
  "humor",
  "deportes",
  "comunidad",
  "otros",
] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

/**
 * Default sensato al publicar: "otros". Es honesto (no inventa un tema que la
 * persona no eligió) y mantiene el video dentro del menú de categorías en vez
 * de dejarlo sin casa. La columna es nullable, así que elegir es opcional.
 */
export const DEFAULT_VIDEO_CATEGORY: VideoCategory = "otros";

export function parseVideoCategory(raw: unknown): VideoCategory | null {
  return VIDEO_CATEGORIES.includes(raw as VideoCategory)
    ? (raw as VideoCategory)
    : null;
}

// ---------------------------------------------------------------------------
// Duración declarada: normalización y verificación
// ---------------------------------------------------------------------------

/**
 * `HTMLVideoElement.duration` es un float y puede ser NaN o Infinity (streams,
 * archivos con el índice al final). Se normaliza a un ENTERO DE SEGUNDOS
 * redondeando HACIA ARRIBA: la duración declarada nunca puede ser menor que la
 * real, o el redondeo se convertiría en la forma barata de esquivar el tope
 * (89,6 s declarados como 89 es benigno; 90,4 declarados como 90, no).
 *
 * Devuelve null cuando la duración es DESCONOCIDA — que no es lo mismo que
 * "corta" (mismo criterio que la 0049 para los 7 videos anteriores).
 */
export function normalizeDeclaredDuration(raw: unknown): number | null {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil(value));
}

export type DurationRejection = "unknown" | "too-long";

export type DurationCheck =
  | { ok: true; seconds: number }
  | { ok: false; reason: DurationRejection };

/**
 * ¿Este video se puede publicar como `type`? Único camino de validación: lo
 * llaman el composer (antes de subir un byte) y la server action (antes de
 * insertar). Que los dos hagan la MISMA pregunta al MISMO módulo es lo que
 * evita que el formulario y el servidor se separen.
 *
 * `unknown` no se trata como válido: un video cuya duración no se pudo leer no
 * se publica. Es la contracara de la exención de la 0049 — los 7 videos viejos
 * quedan con duración desconocida, pero ninguno nuevo puede nacer así.
 */
export function checkVideoDuration(type: VideoType, raw: unknown): DurationCheck {
  const seconds = normalizeDeclaredDuration(raw);
  if (seconds === null) return { ok: false, reason: "unknown" };
  if (seconds > maxDurationFor(type)) return { ok: false, reason: "too-long" };
  return { ok: true, seconds };
}

// ---------------------------------------------------------------------------
// Reproducción por superficie
// ---------------------------------------------------------------------------

/**
 * Dónde se está mirando el video. No es lo mismo que el tipo: un mismo corto de
 * 90 s se reproduce entero en el reel y sólo 59 s en la tarjeta del feed.
 */
export type VideoSurface = "feed" | "reel" | "detail" | "advertising";

/**
 * Segundos que esa superficie reproduce antes de volver al inicio. Los cuatro
 * números salen de acá y de ningún otro lado.
 */
export function playbackCapSeconds(surface: VideoSurface): number {
  switch (surface) {
    case "feed":
      return FEED_PREVIEW_MAX_SECONDS;
    case "reel":
      return SHORT_VIDEO_MAX_SECONDS;
    case "detail":
      return PREMIUM_DETAIL_MAX_SECONDS;
    case "advertising":
      return ADVERTISING_VIDEO_MAX_SECONDS;
  }
}

/**
 * ¿Lo que se ve en el feed es una VISTA PREVIA (hay más video del que se está
 * mostrando)? Se responde con la duración MEDIDA por el navegador, no con la
 * declarada: en la tarjeta ya está el archivo cargado y su metadata es el dato
 * más honesto que tenemos. Duración desconocida ⇒ no se promete "hay más".
 */
export function isPreviewTruncated(measuredSeconds: number | null | undefined): boolean {
  if (typeof measuredSeconds !== "number" || !Number.isFinite(measuredSeconds)) {
    return false;
  }
  // Medio segundo de tolerancia: un archivo de 59,2 s no es "hay más video".
  return measuredSeconds > FEED_PREVIEW_MAX_SECONDS + 0.5;
}

// ---------------------------------------------------------------------------
// Elegibilidad para el scroll de Videos Cortos
// ---------------------------------------------------------------------------

export interface ShortFeedCandidate {
  /** posts.video_type. null = la publicación no declaró ser un video. */
  videoType?: string | null;
  /** posts.eligible_for_short_feed. Es un VETO, no una afirmación. */
  eligibleForShortFeed?: boolean | null;
  /** posts.status — sólo el contenido público entra al reel. */
  status?: string | null;
  /** ¿La publicación trae al menos un archivo de video? */
  hasVideoMedia: boolean;
  /** posts.duration_seconds. null = DESCONOCIDA (no "corta"). */
  durationSeconds?: number | null;
  /** posts.is_paid_ad — publicidad paga nunca va al scroll orgánico. */
  isPaidAd?: boolean | null;
}

/**
 * ¿Este post entra al scroll de Videos Cortos? Espeja el predicado del índice
 * parcial de la 0046 y le suma lo que la base no puede mirar desde un CHECK.
 *
 * TRES TRAMPAS QUE ESTA FUNCIÓN EXISTE PARA NO PISAR:
 *
 *  1. `eligible_for_short_feed` es un VETO. Su default es `true`, así que una
 *     publicación de TEXTO también lo tiene en true: por sí solo no mete nada
 *     en el reel. Por eso se sigue exigiendo medio de video Y `short_video`.
 *  2. `advertising_video` no se descarta sólo por su tipo: se descarta también
 *     por `is_paid_ad` y por el veto, que es lo que la base garantiza como
 *     conjunto (constraint `posts_advertising_video_rules`).
 *  3. Duración NULL en un video significa DESCONOCIDA. Los 7 videos anteriores
 *     a la 0046 están así y siguen siendo cortos elegibles —sacarlos del reel
 *     sería inventar un dato en la otra dirección—, pero una duración conocida
 *     y mayor al tope descarta, aunque la fila diga ser elegible.
 */
export function isEligibleForShortFeed(candidate: ShortFeedCandidate): boolean {
  if (!candidate.hasVideoMedia) return false;
  if (candidate.videoType !== "short_video") return false;
  if (candidate.eligibleForShortFeed === false) return false;
  if (candidate.isPaidAd === true) return false;
  if (candidate.status != null && candidate.status !== "published") return false;
  if (
    typeof candidate.durationSeconds === "number" &&
    candidate.durationSeconds > SHORT_VIDEO_MAX_SECONDS
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** "0:42" · "1:30" · "10:00". Para el chip de duración del composer. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const total = Math.ceil(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
