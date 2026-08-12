/**
 * PISTA DE MÚSICA de una publicación — contrato puro (0090).
 *
 * Sin DOM y sin Supabase: lo importan por igual la server action, el picker y
 * la insignia. Lo que toca el `<audio>` vive en `audio-mix.ts`.
 *
 * LA DECISIÓN QUE GOBIERNA ESTE ARCHIVO: la música NO se mezcla dentro del
 * video. Se guarda como pista asociada (`post_music`) y suena sincronizada en
 * el cliente. Por eso acá hay un RECORTE (desde qué segundo y cuánto dura) y no
 * un pipeline de encoding. El porqué completo está en la cabecera de
 * `supabase/migrations/0090_musica_en_publicaciones.sql`.
 */

// ---------------------------------------------------------------------------
// El recorte
// ---------------------------------------------------------------------------

/**
 * Cuánto dura el fragmento que se publica. 30 s es el largo de una vuelta del
 * carrusel mirando sin apuro y entra dentro del tope de 59 s que ya reproduce
 * la tarjeta de video (`playbackCapSeconds("feed")`): la música nunca sigue
 * sonando después de que el video se reinició.
 *
 * Es una CONSTANTE de la app y no una columna por fila a propósito: guardar el
 * largo por publicación abre la puerta a recortes de cuatro minutos, que es
 * exactamente lo que "publicar una canción entera" significa en términos de
 * licencia.
 */
export const MUSIC_CLIP_SECONDS = 30;

/**
 * Piso del recorte. Una pista más corta que esto igual se puede usar: suena
 * entera y vuelve a empezar. Debajo de 15 s el loop se escucha como un tic.
 */
export const MUSIC_CLIP_MIN_SECONDS = 15;

// ---------------------------------------------------------------------------
// Licencias
// ---------------------------------------------------------------------------

/** Espeja el check `license_kind` de `music_tracks` (0090). */
export const MUSIC_LICENSE_KINDS = [
  "pending",
  "cc0",
  "public_domain",
  "cc_by",
  "cc_by_sa",
  "licensed",
] as const;

export type MusicLicenseKind = (typeof MUSIC_LICENSE_KINDS)[number];

/** Espeja el check `category` de `music_tracks` (0090). */
export const MUSIC_CATEGORIES = [
  "general",
  "alegre",
  "tranquila",
  "urbana",
  "tropical",
  "romantica",
] as const;

export type MusicCategory = (typeof MUSIC_CATEGORIES)[number];

/**
 * Las licencias que OBLIGAN a nombrar al autor donde suena la música. La fila
 * de la base trae su propio `attribution_required` —manda esa, porque un
 * contrato puntual puede exigir atribución aunque el tipo de licencia no—, pero
 * este set es la red: una pista `cc_by` con la bandera mal cargada igual se
 * atribuye.
 */
const LICENSES_REQUIRING_ATTRIBUTION = new Set<MusicLicenseKind>(["cc_by", "cc_by_sa"]);

export function licenseRequiresAttribution(kind: MusicLicenseKind): boolean {
  return LICENSES_REQUIRING_ATTRIBUTION.has(kind);
}

// ---------------------------------------------------------------------------
// La pista
// ---------------------------------------------------------------------------

/** Una pista del catálogo, ya resuelta para el navegador. */
export interface MusicTrackView {
  id: string;
  title: string;
  /** Nombre del artista tal como hay que mostrarlo. */
  artist: string;
  /** Duración del archivo COMPLETO, en segundos. */
  durationSeconds: number;
  /** URL pública del audio (bucket `music-tracks`). */
  previewUrl: string;
  licenseKind: MusicLicenseKind;
  /** La fila manda; ver `LICENSES_REQUIRING_ATTRIBUTION`. */
  attributionRequired: boolean;
  /** Línea exacta que la licencia obliga a mostrar. null si no obliga. */
  attributionText: string | null;
  category: MusicCategory;
}

/** Pista elegida en el composer, con su recorte. */
export interface PickedTrack {
  id: string;
  title: string;
  artist: string;
  previewUrl: string;
  startSeconds: number;
}

// ---------------------------------------------------------------------------
// URL pública del bucket `music-tracks` (0090)
// ---------------------------------------------------------------------------

/**
 * Path de storage → URL pública. Espejo exacto de `postMediaUrl`
 * (components/feed/helpers.ts): el bucket es público, la app arma la URL contra
 * `/storage/v1/object/public/…` y ese endpoint no consulta RLS.
 *
 * Si ya viene una URL absoluta se respeta tal cual (seed, catálogo externo).
 */
export function musicTrackUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/music-tracks/${path}`;
}

// ---------------------------------------------------------------------------
// El recorte, en números
// ---------------------------------------------------------------------------

/**
 * El segundo más tardío desde el que se puede arrancar sin que el recorte se
 * caiga del final de la canción. Nunca negativo: si la pista dura menos que el
 * recorte, el único arranque posible es 0 y suena entera.
 */
export function maxStartSeconds(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.max(0, Math.floor(durationSeconds - MUSIC_CLIP_SECONDS));
}

/**
 * Deja el offset dentro de lo que la canción permite. Entero: medio segundo de
 * precisión no se escucha y sí ensucia la fila.
 *
 * Es la MISMA función que corre el picker y la que corre el servidor. Que el
 * cliente y la action no puedan discrepar sobre qué offset es válido es el
 * punto: si difirieran, la persona vería un error por un valor que la propia UI
 * le dejó elegir.
 */
export function clampStartSeconds(start: number, durationSeconds: number): number {
  if (!Number.isFinite(start)) return 0;
  const max = maxStartSeconds(durationSeconds);
  return Math.min(Math.max(0, Math.floor(start)), max);
}

/** Segundo en el que termina el recorte (nunca pasa el final del archivo). */
export function clipEndSeconds(start: number, durationSeconds: number): number {
  const from = clampStartSeconds(start, durationSeconds);
  const safeDuration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  return Math.min(safeDuration, from + MUSIC_CLIP_SECONDS);
}

/** Cuánto dura de verdad el fragmento (menos que el tope en pistas cortas). */
export function clipLengthSeconds(start: number, durationSeconds: number): number {
  return Math.max(0, clipEndSeconds(start, durationSeconds) - clampStartSeconds(start, durationSeconds));
}

// ---------------------------------------------------------------------------
// Atribución
// ---------------------------------------------------------------------------

/**
 * La línea que HAY QUE mostrar junto a la publicación, o null si la licencia no
 * lo exige. Que devuelva null no significa "no mostrar nada": el nombre de la
 * pista y el artista se muestran siempre (`MusicBadge`); esto es la letra chica
 * que además es obligación contractual.
 *
 * Devuelve el texto cargado en la fila —el que la licencia pide literalmente— y
 * sólo arma uno propio si la licencia obliga y el texto falta. Ese respaldo no
 * debería activarse nunca: el check `music_tracks_atribucion_obligatoria` (0090)
 * impide activar una pista así. Existe para las filas anteriores a la migración
 * y para que un dato faltante no se traduzca en música sin crédito.
 */
export function attributionLine(track: MusicTrackView): string | null {
  const required = track.attributionRequired || licenseRequiresAttribution(track.licenseKind);
  if (!required) return null;
  const text = track.attributionText?.trim();
  if (text) return text;
  return `${track.title} — ${track.artist}`;
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** Segundos → "0:07" / "2:41". Para el control de recorte y la lista. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
