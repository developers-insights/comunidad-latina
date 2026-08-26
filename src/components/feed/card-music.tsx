"use client";

import { useEffect, useRef, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { attributionLine, clampStartSeconds, clipEndSeconds } from "@/lib/media/audio-track";
import { clipGain, musicTimeFor } from "@/lib/media/audio-mix";
import { claimAudio, followAudio, releaseAudio, stopAudio } from "@/lib/media/audio-channel";
import { MusicBadge } from "./music-badge";
import { MUSIC_COPY } from "./music-copy";
import { useAudioChannel } from "./use-audio-channel";
import type { PostMusicView } from "./helpers";

/**
 * LA MÚSICA DE LA PUBLICACIÓN, SONANDO (0090 + feedback 2026-08-26).
 *
 * Hasta hoy la pista sólo se escuchaba si el post traía VIDEO: el `<audio>`
 * vivía dentro de la tarjeta de video. Una publicación de fotos con música
 * mostraba la insignia y no sonaba nunca — que es exactamente lo que se
 * reportó ("pude poner música pero cuando scrolleo no suena"). Acá el `<audio>`
 * pasa a ser del POST, igual que la pista (`post_music`, PK post_id), y por eso
 * suena tenga fotos, video, o las dos cosas.
 *
 * TRES COSAS, y las tres viven juntas a propósito:
 *
 *  1. El `<audio>` con el recorte en loop y su desvanecido en las puntas.
 *  2. El OBSERVADOR de visibilidad: cuando la publicación entra en pantalla se
 *     ofrece a sonar (`followAudio`), cuando sale suelta el sonido. El canal
 *     único decide si le toca — sin gesto previo de la persona, no le toca.
 *  3. El CONTROL: la propia insignia es el botón de play/pausa. No se le suma
 *     un botón nuevo a la foto porque la insignia ya está ahí, ya dice qué
 *     canción es, y ya es lo que la persona mira cuando se pregunta qué suena.
 *
 * Por qué la insignia y no un altavoz aparte: en una publicación con música el
 * único audio posible es la música (`resolveAudioMix`, regla 2 — la pista gana
 * y el video queda mudo). Dos controles para una sola cosa es cómo se llega a
 * un botón que dice "silenciar" mientras el otro dice "escuchar".
 */

/** Visibilidad mínima para que la publicación se ofrezca a sonar. */
export const MUSIC_VISIBLE_RATIO = 0.6;
/**
 * Espera antes de tomar el sonido. Más corta que la del video (2 s): el video
 * espera para no disparar decenas de reproducciones en un scroll rápido, y acá
 * la reproducción ya la limita el canal (una sola a la vez). Medio segundo
 * alcanza para que pasar de largo no encienda la canción, y no tanto como para
 * que quedarse mirando una foto se sienta mudo.
 */
export const MUSIC_AUTOPLAY_DELAY_MS = 500;

function safePlay(media: HTMLMediaElement) {
  try {
    const result = media.play() as Promise<void> | undefined;
    result?.catch(() => undefined);
  } catch {
    // El navegador rechazó la reproducción: no hay nada que hacer ni que avisar.
  }
}

export interface CardMusicProps {
  postId: string;
  music: PostMusicView;
  /**
   * El contenedor de los MEDIOS de la publicación. Su visibilidad es la que
   * manda: la insignia es chica y está en una esquina, y observarla a ella
   * haría que la música arrancara con la foto todavía a medio entrar.
   */
  targetRef: RefObject<HTMLElement | null>;
  className?: string;
}

export function CardMusic({ postId, music, targetRef, className }: CardMusicProps) {
  const { playing } = useAudioChannel(postId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const delayRef = useRef<number | null>(null);
  /** Segundo del RECORTE (post_music.start_seconds) desde el que arranca la vuelta. */
  const clipStartRef = useRef(0);

  // Lo único que traduce el canal al DOM. El resto del archivo decide QUIÉN
  // suena; esto es lo que hace que suene.
  useEffect(() => {
    const node = audioRef.current;
    if (!node) return;
    node.muted = !playing;
    if (playing) safePlay(node);
    else node.pause();
  }, [playing]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || typeof IntersectionObserver === "undefined") return;

    const clearDelay = () => {
      if (delayRef.current !== null) {
        clearTimeout(delayRef.current);
        delayRef.current = null;
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const visible = entry.isIntersecting && entry.intersectionRatio >= MUSIC_VISIBLE_RATIO;
          if (visible) {
            if (delayRef.current === null) {
              delayRef.current = window.setTimeout(() => {
                delayRef.current = null;
                followAudio(postId);
              }, MUSIC_AUTOPLAY_DELAY_MS);
            }
          } else {
            clearDelay();
            // Suelta el sonido SIN apagar el gesto: la publicación que entra lo
            // hereda, y así el feed se escucha de corrido mientras se scrollea.
            releaseAudio(postId);
          }
        }
      },
      { threshold: [MUSIC_VISIBLE_RATIO] },
    );
    io.observe(target);
    return () => {
      clearDelay();
      io.disconnect();
      // Desmontarse callado: una card que se va del DOM no puede dejar el canal
      // tomado por una publicación que ya no está en pantalla.
      releaseAudio(postId);
    };
  }, [postId, targetRef]);

  /**
   * El recorte se repite y se desvanece en las puntas — MISMO patrón que la
   * vista previa del picker (`music-picker.tsx`): lo dispara el propio
   * `timeupdate` del `<audio>`, sin un `setInterval` que sobreviva a la card.
   */
  function handleTimeUpdate() {
    const node = audioRef.current;
    if (!node) return;
    const start = clipStartRef.current;
    const end = clipEndSeconds(start, music.track.durationSeconds);
    const elapsed = node.currentTime - start;
    node.volume = clipGain(elapsed, Math.max(0, end - start));
    if (node.currentTime >= end) {
      node.currentTime = musicTimeFor(start, 0, music.track.durationSeconds);
    }
  }

  function toggle(event: React.MouseEvent) {
    // La insignia vive ENCIMA de la foto: el toque no puede abrir el visor.
    event.stopPropagation();
    if (playing) stopAudio();
    else claimAudio(postId);
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        // Dice la CANCIÓN y no sólo la acción: dentro de un botón, un
        // `aria-label` reemplaza a todo el contenido, y "Escuchar" a secas
        // dejaría a quien usa lector de pantalla sin saber qué suena — que es
        // justo el dato que la insignia existe para dar.
        aria-label={
          playing ? MUSIC_COPY.stop(music.track.title) : MUSIC_COPY.play(music.track.title)
        }
        aria-pressed={playing}
        className={cn(
          "block max-w-full rounded-full text-left",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <MusicBadge
          title={music.track.title}
          artist={music.track.artist}
          attribution={attributionLine(music.track)}
          playing={playing}
        />
      </button>

      {/* `preload="none"`: un feed lleno de publicaciones con música no puede
          bajar 40 archivos de audio de arriba. Se baja el que va a sonar. */}
      <audio
        ref={audioRef}
        src={music.track.previewUrl}
        preload="none"
        muted
        onLoadedMetadata={(event) => {
          const start = clampStartSeconds(music.startSeconds, music.track.durationSeconds);
          clipStartRef.current = start;
          event.currentTarget.currentTime = start;
        }}
        onTimeUpdate={handleTimeUpdate}
      />
    </div>
  );
}
