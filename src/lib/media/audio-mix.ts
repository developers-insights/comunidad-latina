/**
 * QUÉ SUENA Y CUÁNDO cuando una publicación tiene música (0090).
 *
 * La música no está mezclada en el archivo: son DOS elementos —el `<video>` y
 * un `<audio>`— sonando sobre la misma tarjeta. Alguien tiene que decidir cuál
 * habla, y esa decisión no puede vivir repartida entre la tarjeta, el visor y
 * el reel: es este módulo, puro y testeable, el que la toma.
 *
 * LAS TRES REGLAS, y por qué:
 *
 *  1. SILENCIO POR DEFECTO, siempre. Sin un gesto de la persona no suena nada.
 *     No es sólo que los navegadores bloqueen el autoplay con sonido: es que un
 *     feed que arranca a cantar solo en el colectivo es hostil. La tarjeta ya
 *     hace autoplay MUTED del video (card-video.tsx) y eso no cambia.
 *
 *  2. SI HAY MÚSICA, GANA LA MÚSICA. El autor eligió una canción para su
 *     publicación: eligió reemplazar la banda sonora, igual que en cualquier
 *     app social. El video se silencia. Sumar los dos audios no es una opción
 *     intermedia razonable — es ruido, y encima ilegible para quien lee labios.
 *
 *  3. SIN MÚSICA, MANDA EL VIDEO. Una publicación sin pista se comporta
 *     exactamente como antes de esta feature.
 *
 * Consecuencia deliberada: un video con voz (alguien contando algo) al que le
 * pegan música pierde la voz. Es lo que el autor pidió al elegir la canción, y
 * es reversible en un toque — sacar la pista devuelve el audio original,
 * porque el archivo nunca se tocó. Ese es justamente el argumento de la
 * arquitectura de pista asociada frente a mezclar con ffmpeg: la decisión no es
 * definitiva.
 */

import { MUSIC_CLIP_SECONDS, clampStartSeconds } from "./audio-track";

// ---------------------------------------------------------------------------
// El árbitro
// ---------------------------------------------------------------------------

export interface AudioMixInput {
  /** La publicación tiene una pista asociada (`post_music`). */
  hasMusic: boolean;
  /** El archivo de video trae audio propio. Sin video, false. */
  videoHasSound: boolean;
  /**
   * La persona pidió sonido tocando el botón. Es un GESTO real: nunca se puede
   * inferir de un scroll, un hover ni de una preferencia guardada de otra card.
   */
  soundOn: boolean;
}

export type AudioSource = "silent" | "music" | "video";

export interface AudioMixState {
  /** Quién habla. `silent` = nadie. */
  source: AudioSource;
  /** Qué ponerle al `<video muted>`. */
  videoMuted: boolean;
  /** Qué ponerle al `<audio muted>` de la música. */
  musicMuted: boolean;
  /**
   * ¿Tiene sentido ofrecer el botón de sonido en esta card? False cuando no hay
   * nada que escuchar: un carrusel de fotos sin música, o un video mudo sin
   * música. Un botón de altavoz que no hace nada es peor que no tenerlo.
   */
  canToggleSound: boolean;
}

export function resolveAudioMix(input: AudioMixInput): AudioMixState {
  const { hasMusic, videoHasSound, soundOn } = input;
  const canToggleSound = hasMusic || videoHasSound;

  // Regla 1: sin gesto, silencio. Y si no hay nada que sonar, tampoco.
  if (!soundOn || !canToggleSound) {
    return { source: "silent", videoMuted: true, musicMuted: true, canToggleSound };
  }
  // Regla 2: la música elegida por el autor reemplaza la banda sonora.
  if (hasMusic) {
    return { source: "music", videoMuted: true, musicMuted: false, canToggleSound };
  }
  // Regla 3.
  return { source: "video", videoMuted: false, musicMuted: true, canToggleSound };
}

// ---------------------------------------------------------------------------
// Dónde va la púa
// ---------------------------------------------------------------------------

/**
 * En qué segundo del ARCHIVO tiene que estar el `<audio>` después de `elapsed`
 * segundos de reproducción, dado el recorte que eligió el autor.
 *
 * El recorte se repite en loop mientras la publicación está a la vista, igual
 * que el video de la tarjeta: por eso el módulo, y no un `loop` a secas —el
 * `loop` del elemento volvería al segundo 0 del archivo, no al arranque del
 * recorte. Con una pista más corta que el recorte, el loop es la canción entera.
 */
export function musicTimeFor(
  startSeconds: number,
  elapsedSeconds: number,
  durationSeconds: number,
): number {
  const from = clampStartSeconds(startSeconds, durationSeconds);
  const safeDuration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  const window = Math.min(MUSIC_CLIP_SECONDS, Math.max(0, safeDuration - from));
  if (window <= 0) return from;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  return from + (elapsed % window);
}

// ---------------------------------------------------------------------------
// El borde del recorte
// ---------------------------------------------------------------------------

/** Cuánto dura el desvanecido en cada punta del recorte. */
export const MUSIC_FADE_SECONDS = 0.4;

/**
 * Volumen (0–1) en un punto del recorte. Entra y sale con un desvanecido corto
 * para que la vuelta del loop no se escuche como un golpe seco — un corte a
 * mitad de una nota es lo que hace que una canción de fondo suene rota.
 *
 * Lineal a propósito: sobre 0,4 s la diferencia con una curva es inaudible y
 * una función lineal se puede leer y testear de un vistazo.
 */
export function clipGain(elapsedInClip: number, clipLength: number): number {
  if (!Number.isFinite(clipLength) || clipLength <= 0) return 0;
  const t = Number.isFinite(elapsedInClip) ? Math.max(0, Math.min(clipLength, elapsedInClip)) : 0;
  // Recorte más corto que dos desvanecidos: se reparte lo que hay, sin llegar a 1.
  const fade = Math.min(MUSIC_FADE_SECONDS, clipLength / 2);
  if (fade <= 0) return 1;
  const rising = t / fade;
  const falling = (clipLength - t) / fade;
  return Math.max(0, Math.min(1, rising, falling));
}
