"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Heart, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react/dist/ssr";
import { usePrefersReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";
import { VIDEOS_COPY } from "@/app/(app)/videos/copy";
import { useCardLike } from "./card-like-context";
import { COPY } from "./copy";
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
 * `play()` puede devolver una promesa rechazada (política de autoplay) o
 * directamente `undefined` (navegadores viejos, jsdom): encadenar `.catch()`
 * a ciegas tiraba un TypeError. Mismo helper que usa el visor.
 */
function safePlay(video: HTMLVideoElement) {
  try {
    const result = video.play() as Promise<void> | undefined;
    result?.catch(() => undefined);
  } catch {
    // El navegador rechazó la reproducción: no hay nada que hacer ni que avisar.
  }
}

export interface CardVideoProps {
  src: string;
  /** Post de origen — para navegar al feed de videos a pantalla completa. */
  postId: string;
  /** Contexto del feed de videos (p. ej. "para-ti" en el feed general). */
  scope: string;
  /** Vistas acumuladas del post; 0 (o sin dato) no muestra píldora. */
  viewCount?: number;
  className?: string;
}

/**
 * Video en el feed (§5): autoplay MUTED cuando ≥60% visible, con ~2s de espera
 * para que un scroll rápido no dispare decenas de reproducciones; loop,
 * playsInline, preload=metadata. Ícono de sonido tocable (no navega).
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
export function CardVideo({ src, postId, scope, viewCount = 0, className }: CardVideoProps) {
  const router = useRouter();
  const reduce = usePrefersReducedMotion();
  const like = useCardLike();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const delayRef = useRef<number | null>(null);
  const tapTimer = useRef<number | null>(null);
  const [muted, setMuted] = useState(true);
  const [bursts, setBursts] = useState(0);

  useEffect(() => {
    // Reduced-motion: no autoplay. El video queda pausado (primer frame).
    if (reduce) return;
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
              }, AUTOPLAY_DELAY_MS);
            }
          } else {
            clearDelay();
            node.pause();
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
  }, [reduce]);

  // Si la card se desmonta con un toque en vuelo (scroll rápido), no dejar que
  // el timer navegue desde una card que ya no está en pantalla.
  useEffect(
    () => () => {
      if (tapTimer.current !== null) clearTimeout(tapTimer.current);
    },
    [],
  );

  function toggleMute(event: React.MouseEvent) {
    event.stopPropagation(); // el toque en el ícono NO abre el visor
    const node = videoRef.current;
    if (!node) return;
    const next = !node.muted;
    node.muted = next;
    setMuted(next);
    // Al activar el sonido, asegurar que esté corriendo (si estaba pausado).
    if (!next) safePlay(node);
  }

  function openVideos() {
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
      />

      {/* Capa de toque: simple = reel a pantalla completa, doble = me gusta. */}
      <button
        type="button"
        onClick={handleTap}
        aria-label={COPY.post.playVideo}
        className="absolute inset-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring"
      />

      {/* Vistas: píldora chica a la IZQUIERDA — el sonido vive a la derecha. */}
      {viewCount > 0 && (
        <span
          className="cl-print-fill pointer-events-none absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-media-scrim px-2 py-0.5 text-xs font-semibold text-on-media backdrop-blur-sm"
          aria-hidden="true"
        >
          <Eye size={13} weight="fill" />
          {VIDEOS_COPY.viewsLabel(viewCount)}
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

      {/* Sonido: 44px de área táctil aunque el círculo sea de 36px. No navega. */}
      <button
        type="button"
        onClick={toggleMute}
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
    </div>
  );
}
