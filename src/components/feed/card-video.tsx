"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Heart, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react/dist/ssr";
import { usePrefersReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";
import { isPreviewTruncated, playbackCapSeconds } from "@/lib/media/video-policy";
import { clampStartSeconds, clipEndSeconds } from "@/lib/media/audio-track";
import { clipGain, musicTimeFor, resolveAudioMix } from "@/lib/media/audio-mix";
import { VIDEOS_COPY } from "@/app/(app)/videos/copy";
import { useCardLike } from "./card-like-context";
import { COPY } from "./copy";
import type { PostMusicView, VideoScopeProp } from "./helpers";
import styles from "./card-post-media.module.css";

/** Umbral de visibilidad para autoplay (pedido cliente: "cuando se ve el 60%"). */
const VISIBLE_RATIO = 0.6;
/** Delay antes de arrancar (pedido cliente: "que espere ~2 segundos"). */
const AUTOPLAY_DELAY_MS = 2000;
/**
 * Ventana para distinguir un toque simple de un doble toque. MISMO valor que
 * el DOUBLE_TAP_MS de card-post-media (la foto y el video de una card tienen
 * que sentirse igual de rápidos) — se repite acá para no importar entre los dos
 * módulos y armar un ciclo (card-post-media ya importa a CardVideo).
 */
const DOUBLE_TAP_MS = 250;

/**
 * Scope que significa "acá NO hay reel". El scroll vertical infinito de videos
 * existe SÓLO donde el contenido ya es un flujo: el feed (`/feed`) y la sección
 * Videos (`/videos`). En una pantalla que muestra UNA publicación —el detalle de
 * un post, al que se llega desde el perfil de alguien o desde las novedades de
 * un evento— el video se mira ahí y se vuelve a donde estabas (feedback cliente
 * 2026-07-27: "si tú estás en un evento y le das click en un posting… no se
 * scrollean"; "no lo puedes scrollear porque te sale de la propiedad").
 *
 * Quien monta la card pasa este valor como `videoScope`; CardPostMedia lo lee y
 * en vez del reel abre el visor a pantalla completa del propio post.
 */
export const NO_REEL_SCOPE = "sin-reel";

/**
 * `play()` puede devolver una promesa rechazada (política de autoplay) o
 * directamente `undefined` (navegadores viejos, jsdom): encadenar `.catch()`
 * a ciegas tiraba un TypeError. Mismo helper que usa el visor.
 *
 * `HTMLMediaElement` y no `HTMLVideoElement`: desde 0061 este helper también
 * arranca el `<audio>` de la música — mismo método, misma promesa opcional,
 * en las dos clases que lo implementan.
 */
function safePlay(media: HTMLMediaElement) {
  try {
    const result = media.play() as Promise<void> | undefined;
    result?.catch(() => undefined);
  } catch {
    // El navegador rechazó la reproducción: no hay nada que hacer ni que avisar.
  }
}

export interface CardVideoProps {
  src: string;
  /** Post de origen — para navegar al feed de videos a pantalla completa. */
  postId: string;
  /**
   * Contexto del feed de videos (p. ej. "para-ti" en el feed general). Tipado
   * como el resto de la cadena: un scope inventado no puede llegar hasta la URL
   * del reel sin que el compilador lo frene (ver `VideoScopeProp`).
   */
  scope: VideoScopeProp;
  /** Vistas acumuladas del post; 0 (o sin dato) no muestra píldora. */
  viewCount?: number;
  /**
   * ¿Es el medio que se está viendo? Sólo el activo puede reproducir. En un post
   * con varios medios (MediaCarousel) esto garantiza que NUNCA suenen dos videos
   * a la vez: al salir de su diapositiva el video se pausa, aunque siga entrando
   * en el viewport de reojo durante el swipe. Un video suelto es siempre activo.
   */
  active?: boolean;
  /**
   * Qué hace el toque simple. Sin esto abre el reel vertical (`/videos`) — el
   * camino del feed. Con esto manda quien monta el video: el detalle de una
   * publicación abre el visor a pantalla completa y NO el scroll infinito.
   */
  onTap?: () => void;
  className?: string;
  /**
   * Pista asociada al POST (0090). null = sin música → el video se comporta
   * exactamente como antes (manda su propio audio). Con música, gana la
   * música: ver `resolveAudioMix` (audio-mix.ts), el árbitro único de qué
   * suena y cuándo.
   */
  music?: PostMusicView | null;
}

/** Segundos que la TARJETA reproduce. El completo se abre desde la publicación. */
const PREVIEW_CAP_SECONDS = playbackCapSeconds("feed");

/**
 * Video en el feed (§5): autoplay MUTED cuando ≥60% visible, con ~2s de espera
 * para que un scroll rápido no dispare decenas de reproducciones; loop,
 * playsInline, preload=metadata. Ícono de sonido tocable (no navega).
 *
 * VISTA PREVIA DE 59 s (contrato 2026-07-30 §6): la tarjeta muestra un anticipo,
 * no el video. Al llegar al tope vuelve a empezar, y si el archivo dura más se
 * dice —"Vista previa"— en vez de dejar que parezca un video que se corta solo.
 * La duración sale de la METADATA del archivo, ya cargada acá: es el dato más
 * honesto disponible y no depende de que la fila la haya declarado (los videos
 * anteriores a la 0046 no la declaran).
 *
 * Interacción sobre el video — MISMA gramática que la foto (card-post-media):
 *  - un toque abre el feed de videos a pantalla completa (`/videos`);
 *  - doble toque da me gusta (corazón grande animado en el centro) reusando el
 *    estado compartido del post (useCardLike). El doble-tap es EXTRA: el botón
 *    de me gusta de PostActions sigue siendo el camino accesible.
 *
 * prefers-reduced-motion: NO autoplay (el video reproduce en frío es movimiento).
 * Queda en pausa mostrando su primer frame; el usuario abre el visor si quiere.
 */
export function CardVideo({
  src,
  postId,
  scope,
  viewCount = 0,
  active = true,
  onTap,
  className,
  music = null,
}: CardVideoProps) {
  const router = useRouter();
  const reduce = usePrefersReducedMotion();
  const like = useCardLike();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const delayRef = useRef<number | null>(null);
  const tapTimer = useRef<number | null>(null);
  /** Segundo del RECORTE (post_music.start_seconds) desde el que arranca la vuelta actual. */
  const musicClipStartRef = useRef(0);
  /** El GESTO de la persona: pidió sonido o no. Nunca se infiere de nada más. */
  const [soundOn, setSoundOn] = useState(false);
  const [bursts, setBursts] = useState(0);
  /** Duración MEDIDA del archivo (metadata), no la declarada. null = todavía no. */
  const [measuredSeconds, setMeasuredSeconds] = useState<number | null>(null);
  const isPreview = isPreviewTruncated(measuredSeconds);

  const hasMusic = Boolean(music);
  /**
   * `videoHasSound` va en `true` a propósito: no hay forma de saber si el
   * archivo trae pista de audio sin decodificarlo, y el botón de sonido YA
   * estaba disponible para todo video antes de esta feature. El árbitro
   * (audio-mix.ts) sigue siendo la única fuente de qué suena de verdad — acá
   * sólo se le da el dato más conservador que se tiene.
   */
  const mix = resolveAudioMix({ hasMusic, videoHasSound: true, soundOn });
  const muted = mix.source === "silent";

  // Dejar de ser el medio activo (el usuario pasó a la foto siguiente del
  // carrusel) pausa YA, sin esperar a que el observer note que salió de vista.
  // La música es del post: pausa junto con el video, nunca sigue sola.
  useEffect(() => {
    if (active) return;
    videoRef.current?.pause();
    audioRef.current?.pause();
  }, [active]);

  // El `<video muted>` es un atributo DOM que no se controla vía JSX (se pisa
  // a mano, igual que antes): acá se refleja lo que decide el árbitro cada vez
  // que el gesto de sonido cambia. Al desmutear también se retoma la
  // reproducción — mismo comportamiento que el toggle de siempre.
  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    node.muted = mix.videoMuted;
    if (!mix.videoMuted) safePlay(node);
  }, [mix.videoMuted]);

  // Mismo trato para la música: mutear/desmutear el `<audio>` y retomarla al
  // desmutear. Si no hay pista, `audioRef.current` es null (no se monta el
  // elemento) y esto no hace nada.
  useEffect(() => {
    const node = audioRef.current;
    if (!node) return;
    node.muted = mix.musicMuted;
    if (!mix.musicMuted) safePlay(node);
  }, [mix.musicMuted]);

  useEffect(() => {
    // Reduced-motion: no autoplay. El video (y la música) quedan pausados.
    if (reduce) return;
    // Fuera de la diapositiva visible no se arranca nada: dos videos del mismo
    // post no pueden sonar juntos.
    if (!active) return;
    const node = videoRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const clearDelay = () => {
      if (delayRef.current !== null) {
        clearTimeout(delayRef.current);
        delayRef.current = null;
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const visible = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO;
          if (visible) {
            // Sólo un timer a la vez: si ya está agendado, no reagendar.
            if (delayRef.current === null) {
              delayRef.current = window.setTimeout(() => {
                delayRef.current = null;
                // Autoplay muted: si el navegador igual lo bloquea, no pasa nada.
                safePlay(node);
                // La música acompaña el mismo ciclo de vida que el video: sale
                // de pantalla, se calla; vuelve a entrar, retoma (en silencio,
                // como el video, hasta que la persona toque el altavoz).
                const audioNode = audioRef.current;
                if (audioNode) safePlay(audioNode);
              }, AUTOPLAY_DELAY_MS);
            }
          } else {
            clearDelay();
            node.pause();
            audioRef.current?.pause();
          }
        }
      },
      { threshold: [VISIBLE_RATIO] },
    );
    io.observe(node);
    return () => {
      clearDelay();
      io.disconnect();
    };
  }, [reduce, active]);

  // Si la card se desmonta con un toque en vuelo (scroll rápido), no dejar que
  // el timer navegue desde una card que ya no está en pantalla.
  useEffect(
    () => () => {
      if (tapTimer.current !== null) clearTimeout(tapTimer.current);
    },
    [],
  );

  /**
   * El único gesto de sonido de la card: no decide DIRECTAMENTE qué mutear —
   * sólo cambia el pedido de la persona. El árbitro (`mix`, arriba) es quien
   * traduce ese pedido en video mudo / música sonando / video sonando, y los
   * dos efectos de arriba son los que aplican esa traducción al DOM.
   */
  function toggleSound(event: React.MouseEvent) {
    event.stopPropagation(); // el toque en el ícono NO abre el visor
    setSoundOn((current) => !current);
  }

  /**
   * El recorte se repite y se desvanece en las puntas — MISMO patrón que la
   * vista previa del picker (`music-picker.tsx:handleTimeUpdate`): el propio
   * `timeupdate` del `<audio>` dispara el loop, sin un `setInterval` propio
   * que sobreviva a la card.
   */
  function handleMusicTimeUpdate() {
    const node = audioRef.current;
    if (!node || !music) return;
    const start = musicClipStartRef.current;
    const end = clipEndSeconds(start, music.track.durationSeconds);
    const elapsed = node.currentTime - start;
    node.volume = clipGain(elapsed, Math.max(0, end - start));
    if (node.currentTime >= end) {
      node.currentTime = musicTimeFor(start, 0, music.track.durationSeconds);
    }
  }

  function openVideos() {
    // Fuera del feed y de /videos no hay reel: quien monta el video decide qué
    // pasa (ver NO_REEL_SCOPE y CardPostMedia).
    if (onTap) {
      onTap();
      return;
    }
    router.push(
      `/videos?start=${encodeURIComponent(postId)}&scope=${encodeURIComponent(scope)}`,
    );
  }

  function handleDoubleTap() {
    if (!like) return;
    // El corazón grande es feedback visual: se muestra cuando hay sesión (aunque
    // el post ya estuviera likeado, como Instagram). Sin sesión, likeOnce lleva
    // a /entrar y no mostramos un corazón que mentiría un me gusta inexistente.
    if (like.canReact) setBursts((current) => current + 1);
    like.likeOnce();
  }

  function handleTap() {
    // Un toque abre el reel; dos toques (dentro de la ventana) dan me gusta.
    if (tapTimer.current !== null) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      handleDoubleTap();
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      openVideos();
    }, DOUBLE_TAP_MS);
  }

  return (
    <div className={cn("relative", className)}>
      <video
        ref={videoRef}
        src={src}
        className="aspect-[4/5] w-full bg-surface-subtle object-cover"
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          setMeasuredSeconds(Number.isFinite(value) ? value : null);
        }}
        // El tope de la vista previa: al llegar vuelve a empezar (el `loop` ya
        // está puesto, así que no hay corte). Escribir `currentTime` acá y no
        // en un intervalo propio evita un timer por cada video del feed.
        onTimeUpdate={(event) => {
          const node = event.currentTarget;
          if (node.currentTime >= PREVIEW_CAP_SECONDS) node.currentTime = 0;
        }}
      />

      {/* Hermano del video, no mezclado en el archivo (ver audio-mix.ts):
          suena SINCRONIZADO por encima, nunca los dos a la vez con el video
          (eso lo garantiza `mix`, arriba). `preload="none"`: un feed lleno de
          videos con música no puede bajar 40 archivos de audio de arriba. */}
      {music && (
        <audio
          ref={audioRef}
          src={music.track.previewUrl}
          preload="none"
          muted
          onLoadedMetadata={(event) => {
            const start = clampStartSeconds(music.startSeconds, music.track.durationSeconds);
            musicClipStartRef.current = start;
            event.currentTarget.currentTime = start;
          }}
          onTimeUpdate={handleMusicTimeUpdate}
        />
      )}

      {/* Capa de toque: simple = reel a pantalla completa, doble = me gusta. */}
      <button
        type="button"
        onClick={handleTap}
        // Fuera de la diapositiva visible sale de la tabulación: entrar a un
        // carrusel no puede obligar a pasar por los medios que no se ven.
        tabIndex={active ? 0 : -1}
        // La etiqueta dice lo que el toque HACE. Sobre una vista previa eso es
        // "ver el video completo", que además es la única forma de enterarse de
        // que hay más video sin ver la píldora.
        aria-label={isPreview ? COPY.post.playFullVideo : COPY.post.playVideo}
        className="absolute inset-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring"
      />

      {/* Píldora chica a la IZQUIERDA — el sonido vive a la derecha. Lleva dos
          datos que conviven en la misma cápsula a propósito: dos píldoras
          apiladas sobre el video son ruido, y la de vistas ya estaba acá.
          `aria-hidden`: lo que significan lo dice el botón de abajo, que es el
          elemento que se enfoca y se toca. */}
      {(isPreview || viewCount > 0) && (
        <span
          className="cl-print-fill pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-media-scrim px-2 py-0.5 text-xs font-semibold text-on-media backdrop-blur-sm"
          aria-hidden="true"
        >
          {isPreview && <span>{COPY.post.previewChip}</span>}
          {isPreview && viewCount > 0 && <span className="opacity-60">·</span>}
          {viewCount > 0 && (
            <span className="flex items-center gap-1">
              <Eye size={13} weight="fill" />
              {VIDEOS_COPY.viewsLabel(viewCount)}
            </span>
          )}
        </span>
      )}

      {/* Corazón grande del doble-tap (decorativo; el estado lo comunica el botón). */}
      {bursts > 0 && (
        <span
          className="pointer-events-none absolute inset-0 grid place-items-center"
          aria-hidden="true"
        >
          <Heart
            key={bursts}
            weight="fill"
            size={96}
            className={cn(
              "text-on-media drop-shadow-lg",
              reduce ? styles.heartFade : styles.heartPop,
            )}
          />
        </span>
      )}

      {/* Sonido: 44px de área táctil aunque el círculo sea de 36px. No navega.
          Oculto cuando no hay NADA que sonar (`!mix.canToggleSound`): un
          altavoz que no hace nada es peor que no tenerlo. */}
      {mix.canToggleSound && (
        <button
          type="button"
          onClick={toggleSound}
          tabIndex={active ? 0 : -1}
          aria-label={muted ? COPY.post.unmuteVideo : COPY.post.muteVideo}
          className="absolute bottom-2 right-2 grid min-h-11 min-w-11 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <span className="grid size-9 place-items-center rounded-full bg-media-shade/60 text-on-media backdrop-blur-sm transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-90">
            {muted ? (
              <SpeakerSlash size={18} weight="fill" aria-hidden="true" />
            ) : (
              <SpeakerHigh size={18} weight="fill" aria-hidden="true" />
            )}
          </span>
        </button>
      )}
    </div>
  );
}
