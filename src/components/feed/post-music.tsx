"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react/dist/ssr";
import { usePrefersReducedMotion } from "@/components/motion";
import { safePlayMedia } from "@/components/video/playable-media";
import { cn } from "@/lib/utils";
import { clipEndSeconds, clampStartSeconds } from "@/lib/media/audio-track";
import { clipGain, musicTimeFor, resolveAudioMix, type AudioMixState } from "@/lib/media/audio-mix";
import { COPY } from "./copy";
import type { PostMusicView } from "./helpers";

/**
 * LA MÚSICA ES DE LA PUBLICACIÓN, NO DE UNA DIAPOSITIVA (0090).
 *
 * ─── EL BUG QUE ORIGINÓ ESTE ARCHIVO ────────────────────────────────────────
 * (cliente, 2026-08-26: "cuando se publica con música, no se escucha la música")
 *
 * El `<audio>` de la pista se montaba DENTRO de `card-video.tsx`, y
 * `media-carousel.tsx` sólo le bajaba `music` a la rama del video. Una
 * publicación de FOTO con música mostraba la insignia —"Cumbia del barrio · Los
 * del Sur"— y no montaba ningún elemento de audio: la promesa estaba en
 * pantalla y la canción no existía en el DOM. Tampoco había altavoz, así que ni
 * siquiera había cómo pedirla.
 *
 * La causa de raíz no era "falta un `<audio>` en la foto": era que el
 * reproductor vivía un nivel más abajo de lo que le corresponde. `post_music`
 * tiene PK `post_id` —UNA pista por publicación— y el reproductor estaba en el
 * medio. Montar un segundo `<audio>` del lado de la foto habría arreglado la
 * captura del cliente y roto el carrusel mixto: dos pistas encimadas en cuanto
 * un post trajera fotos Y video.
 *
 * Por eso el elemento, el gesto de sonido y el observador de visibilidad viven
 * ACÁ, a la altura de la publicación. `CardVideo` ya no sabe de música: sólo
 * pregunta si tiene que estar mudo.
 *
 * ─── QUÉ RESUELVE Y QUÉ NO ──────────────────────────────────────────────────
 *  · QUÉ SUENA lo decide `resolveAudioMix` (audio-mix.ts), que sigue siendo el
 *    árbitro único y ya está testeado ahí. Acá sólo se le da el estado de la
 *    publicación y se aplica su veredicto al DOM.
 *  · EL RECORTE (desde qué segundo, cuánto dura, los desvanecidos de las
 *    puntas) lo resuelven `audio-track.ts` y `audio-mix.ts`. El loop lo dispara
 *    el propio `timeupdate` del elemento — mismo patrón que la vista previa del
 *    picker, sin un `setInterval` que sobreviva a la tarjeta.
 *  · LA VISIBILIDAD se observa sobre la caja de MEDIOS de la publicación (el
 *    mismo rectángulo que ocupa el carrusel), no sobre un video: en una
 *    publicación de fotos no hay ningún video que observar.
 *
 * SILENCIO POR DEFECTO, SIEMPRE. Sin un gesto no suena nada, ni acá ni antes;
 * lo que cambia es que ahora el gesto EXISTE también sobre una foto.
 */

/** Cuánto de la caja tiene que verse para que la pista arranque. Mismo umbral
 *  que usa `card-video.tsx` para el autoplay: la música acompaña al medio. */
const VISIBLE_RATIO = 0.6;

export interface PostMusicState {
  /** El veredicto de `resolveAudioMix` para ESTA publicación. */
  mix: AudioMixState;
  /** El gesto de la persona. Nunca se infiere de un scroll ni de otra card. */
  soundOn: boolean;
  toggleSound: () => void;
  /**
   * Callar la pista sin tocar el gesto: la usa el visor a pantalla completa
   * antes de abrir (arranca con su propio sonido) y el video al pausarse.
   */
  pause: () => void;
  /** Retomar tras cerrar el visor. Respeta reduced-motion igual que el video. */
  resume: () => void;
}

const PostMusicContext = createContext<PostMusicState | null>(null);

/**
 * Estado de sonido de la publicación, o `null` si la isla se montó fuera del
 * provider. `null` significa "esta superficie no declaró música": el video se
 * comporta como antes de la 0090 —mudo, sin altavoz— y nadie explota.
 */
export function usePostMusic(): PostMusicState | null {
  return useContext(PostMusicContext);
}

export interface PostMusicProviderProps {
  /** Pista de la publicación. `null` = no hay música (el caso normal). */
  music: PostMusicView | null;
  /**
   * ¿Alguna diapositiva es un video? Es el `videoHasSound` de `resolveAudioMix`
   * a escala de publicación. `true` sin mirar el archivo a propósito: no hay
   * forma de saber si trae pista de audio sin decodificarlo, y el altavoz ya
   * estaba disponible para todo video desde antes de esta feature.
   */
  hasVideo: boolean;
  /** Clases de la caja de medios — este provider ES ese contenedor. */
  className?: string;
  children: ReactNode;
}

/**
 * Envuelve los medios de la publicación y monta su única pista.
 *
 * ES el contenedor de los medios (no suma un `<div>` de más): necesita un
 * elemento real que observar para saber cuándo la publicación está a la vista,
 * y ese elemento es exactamente el rectángulo del carrusel.
 */
export function PostMusicProvider({
  music,
  hasVideo,
  className,
  children,
}: PostMusicProviderProps) {
  const reduce = usePrefersReducedMotion();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Segundo del ARCHIVO donde arranca el recorte publicado (post_music.start_seconds). */
  const clipStartRef = useRef(0);
  const [soundOn, setSoundOn] = useState(false);

  const mix = resolveAudioMix({
    hasMusic: Boolean(music),
    videoHasSound: hasVideo,
    soundOn,
  });

  /**
   * ¿Corresponde que la pista esté sonando ahora? Con reduced-motion no se
   * precalienta en silencio —la tarjeta tampoco arranca el video—, pero un
   * pedido EXPLÍCITO de sonido se cumple igual: reducir movimiento es una
   * preferencia sobre el MOVIMIENTO, no sobre el audio que alguien pidió.
   */
  const puedeSonar = !reduce || soundOn;

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    const node = audioRef.current;
    if (node && puedeSonar) safePlayMedia(node);
  }, [puedeSonar]);

  /**
   * El `muted` de un elemento de medio es una propiedad del DOM que React no
   * controla desde el JSX: se refleja a mano cada vez que el árbitro cambia de
   * opinión. Al desmutear también se retoma — es el mismo toque.
   */
  useEffect(() => {
    const node = audioRef.current;
    if (!node) return;
    node.muted = mix.musicMuted;
    if (!mix.musicMuted) safePlayMedia(node);
  }, [mix.musicMuted]);

  /**
   * Visibilidad de la PUBLICACIÓN. Sin esto, en una publicación de fotos no
   * habría nada que le dijera a la pista cuándo empezar ni cuándo callarse:
   * el observador que existía era el del `<video>`, y acá puede no haber video.
   */
  useEffect(() => {
    if (!music) return;
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
        const node = audioRef.current;
        if (!node) return;
        for (const entry of entries) {
          const visible = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO;
          if (visible && puedeSonar) safePlayMedia(node);
          else if (!visible) node.pause();
        }
      },
      { threshold: [VISIBLE_RATIO] },
    );
    io.observe(box);
    return () => io.disconnect();
    // `puedeSonar` en las dependencias vuelve a armar el observador cuando
    // alguien toca el altavoz: pasa una vez por gesto, y a cambio el callback
    // no necesita leer refs espejo para enterarse del estado actual.
  }, [music, puedeSonar]);

  /**
   * El recorte se repite y se desvanece en las puntas. Lo dispara el propio
   * `timeupdate` del elemento: `loop` a secas volvería al segundo 0 del ARCHIVO,
   * no al arranque del recorte que eligió quien publicó.
   */
  function handleTimeUpdate() {
    const node = audioRef.current;
    if (!node || !music) return;
    const start = clipStartRef.current;
    const end = clipEndSeconds(start, music.track.durationSeconds);
    const elapsed = node.currentTime - start;
    node.volume = clipGain(elapsed, Math.max(0, end - start));
    if (node.currentTime >= end) {
      node.currentTime = musicTimeFor(start, 0, music.track.durationSeconds);
    }
  }

  const value = useMemo<PostMusicState>(
    () => ({
      mix,
      soundOn,
      toggleSound: () => setSoundOn((current) => !current),
      pause,
      resume,
    }),
    [mix, soundOn, pause, resume],
  );

  return (
    <PostMusicContext.Provider value={value}>
      <div ref={boxRef} className={className}>
        {children}
        {/* Hermano de los medios, no mezclado en ningún archivo (ver
            audio-mix.ts). `preload="none"`: un feed con música no puede bajar
            40 mp3 de arriba — el archivo empieza a viajar recién cuando la
            publicación entra en pantalla y se pide reproducir. */}
        {music && (
          <audio
            ref={audioRef}
            src={music.track.previewUrl}
            preload="none"
            muted
            onLoadedMetadata={(event) => {
              const start = clampStartSeconds(
                music.startSeconds,
                music.track.durationSeconds,
              );
              clipStartRef.current = start;
              event.currentTarget.currentTime = start;
            }}
            onTimeUpdate={handleTimeUpdate}
          />
        )}
      </div>
    </PostMusicContext.Provider>
  );
}

/**
 * EL ALTAVOZ DE LA PUBLICACIÓN. Uno solo, quieto, sobre la esquina inferior
 * derecha de los medios — no uno por diapositiva: el gesto es "que esta
 * publicación suene", y un control que salta de lugar al pasar de la foto al
 * video sería otro control cada vez.
 *
 * No se pinta cuando no hay NADA que escuchar (`canToggleSound`): un altavoz
 * que no hace nada es peor que no tenerlo.
 */
export function PostMusicSpeaker({ className }: { className?: string }) {
  const music = usePostMusic();
  if (!music || !music.mix.canToggleSound) return null;

  const muted = music.mix.source === "silent";
  return (
    <button
      type="button"
      onClick={(event) => {
        // El toque en el altavoz NO abre el visor ni da me gusta: muere acá.
        event.stopPropagation();
        music.toggleSound();
      }}
      aria-label={
        muted
          ? COPY.post.unmuteVideo
          : music.mix.source === "music"
            ? COPY.post.muteMusic
            : COPY.post.muteVideo
      }
      className={cn(
        // 44px de blanco táctil aunque el círculo mida 36.
        "absolute z-[3] grid min-h-11 min-w-11 place-items-center rounded-full",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        className,
      )}
    >
      <span className="grid size-9 place-items-center rounded-full bg-media-shade/60 text-on-media backdrop-blur-sm transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-90">
        {muted ? (
          <SpeakerSlash size={18} weight="fill" aria-hidden="true" />
        ) : (
          <SpeakerHigh size={18} weight="fill" aria-hidden="true" />
        )}
      </span>
    </button>
  );
}
