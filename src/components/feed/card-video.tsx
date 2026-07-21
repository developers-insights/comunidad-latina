"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react/dist/ssr";
import { usePrefersReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/** Umbral de visibilidad para autoplay (pedido cliente: "cuando se ve el 60%"). */
const VISIBLE_RATIO = 0.6;
/** Delay antes de arrancar (pedido cliente: "que espere ~2 segundos"). */
const AUTOPLAY_DELAY_MS = 2000;

export interface CardVideoProps {
  src: string;
  /** Post de origen — para navegar al feed de videos a pantalla completa. */
  postId: string;
  /** Contexto del feed de videos (p. ej. "para-ti" en el feed general). */
  scope: string;
  className?: string;
}

/**
 * Video en el feed (§5): autoplay MUTED cuando ≥60% visible, con ~2s de espera
 * para que un scroll rápido no dispare decenas de reproducciones; loop,
 * playsInline, preload=metadata. Ícono de sonido tocable (no navega). Un toque
 * en el video abre el feed de videos a pantalla completa (`/videos`), cuya ruta
 * arma otro agente — acá sólo navegamos.
 *
 * prefers-reduced-motion: NO autoplay (el video reproduce en frío es movimiento).
 * Queda en pausa mostrando su primer frame; el usuario abre el visor si quiere.
 */
export function CardVideo({ src, postId, scope, className }: CardVideoProps) {
  const router = useRouter();
  const reduce = usePrefersReducedMotion();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const delayRef = useRef<number | null>(null);
  const [muted, setMuted] = useState(true);

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
                node.play().catch(() => undefined);
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

  function toggleMute(event: React.MouseEvent) {
    event.stopPropagation(); // el toque en el ícono NO abre el visor
    const node = videoRef.current;
    if (!node) return;
    const next = !node.muted;
    node.muted = next;
    setMuted(next);
    // Al activar el sonido, asegurar que esté corriendo (si estaba pausado).
    if (!next) node.play().catch(() => undefined);
  }

  function openVideos() {
    router.push(
      `/videos?start=${encodeURIComponent(postId)}&scope=${encodeURIComponent(scope)}`,
    );
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

      {/* Capa de toque: abre el feed de videos a pantalla completa. */}
      <button
        type="button"
        onClick={openVideos}
        aria-label={COPY.post.playVideo}
        className="absolute inset-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring"
      />

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
