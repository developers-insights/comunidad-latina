"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, m } from "motion/react";
import { Play, VideoCamera } from "@phosphor-icons/react/dist/ssr";
import { usePrefersReducedMotion } from "@/components/motion";
import { useMediaViewer } from "@/components/feed/media-viewer";
import { CARD_MEDIA_ASPECT, MediaScrimBottom, type CardMediaAspect } from "@/components/ui";
import { formatDuration } from "@/lib/media/video-policy";
import {
  LISTING_VIDEO_CARD_CAP_SECONDS,
  LISTING_VIDEO_COPY as C,
  type ListingVideoView,
} from "@/lib/media/listing-video-policy";
import { cn } from "@/lib/utils";

const VISIBLE_RATIO = 0.6;
const AUTOPLAY_DELAY_MS = 600;

export function ListingVideoMedia({
  video,
  title,
  aspect = "portrait",
  overlayTopLeft,
  overlayBottom,
  onOpen,
  interactive = true,
  className,
}: {
  video: ListingVideoView;
  title: string;
  aspect?: CardMediaAspect;
  overlayTopLeft?: React.ReactNode;
  overlayBottom?: React.ReactNode;
  onOpen?: () => void;
  /** `false` cuando la tarjeta entera ya es un enlace: sin botones adentro de un `<a>`. */
  interactive?: boolean;
  className?: string;
}) {
  const reduce = usePrefersReducedMotion();
  const viewer = useMediaViewer();
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [frenado, setFrenado] = useState(false);
  const duracion = formatDuration(video.durationSeconds);

  useEffect(() => {
    if (reduce || frenado) return;
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === "undefined") return;
    let timer: number | null = null;
    const limpiar = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO) {
            if (timer === null) {
              timer = window.setTimeout(() => {
                timer = null;
                videoRef.current?.play().catch(() => {});
              }, AUTOPLAY_DELAY_MS);
            }
          } else {
            limpiar();
            videoRef.current?.pause();
          }
        }
      },
      { threshold: [VISIBLE_RATIO] },
    );
    io.observe(box);
    return () => {
      limpiar();
      io.disconnect();
    };
  }, [reduce, frenado]);

  function abrir() {
    if (onOpen) {
      onOpen();
      return;
    }
    videoRef.current?.pause();
    viewer.open({
      items: [{ kind: "video", url: video.url, posterUrl: video.posterUrl }],
      authorName: title,
      maxPlaybackSeconds: LISTING_VIDEO_CARD_CAP_SECONDS,
      startSeconds: videoRef.current?.currentTime,
      // La tarjeta pausa antes de abrir (dos copias sonando juntas); sin esto
      // queda congelada al volver, porque nunca dejó de estar a la vista.
      onClose: () => {
        if (!reduce && !frenado) videoRef.current?.play().catch(() => {});
      },
    });
  }

  function aplicarTope(event: React.SyntheticEvent<HTMLVideoElement>) {
    const node = event.currentTarget;
    if (node.currentTime < LISTING_VIDEO_CARD_CAP_SECONDS) return;
    if (interactive && video.fullVideoHref) {
      node.pause();
      setFrenado(true);
      return;
    }
    node.currentTime = 0;
  }

  return (
    <div
      ref={boxRef}
      className={cn("relative w-full overflow-hidden bg-media-shade", CARD_MEDIA_ASPECT[aspect], className)}
    >
      <video
        ref={videoRef}
        src={video.url}
        poster={video.posterUrl || undefined}
        muted
        loop={!interactive || !video.fullVideoHref}
        playsInline
        preload="metadata"
        onTimeUpdate={aplicarTope}
        className="absolute inset-0 size-full object-cover"
      />

      {interactive && (
        <button
          type="button"
          onClick={abrir}
          aria-label={C.reproducir(title)}
          className="absolute inset-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring"
        />
      )}

      <div className="pointer-events-none absolute left-2.5 top-2.5 flex max-w-[70%] flex-wrap gap-1.5">
        <span className="cl-print-fill inline-flex items-center gap-1 rounded-full bg-media-scrim px-2 py-0.5 text-xs font-semibold text-on-media backdrop-blur-sm">
          <VideoCamera size={13} weight="fill" aria-hidden="true" />
          <span className="sr-only">{C.chipVideo}</span>
          {duracion && <span className="numeric">{duracion}</span>}
        </span>
        {overlayTopLeft}
      </div>

      {overlayBottom && <MediaScrimBottom>{overlayBottom}</MediaScrimBottom>}

      <AnimatePresence>
        {interactive && frenado && video.fullVideoHref && (
          <m.div
            key="ver-video-completo"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: reduce ? 0.15 : 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="pointer-events-none absolute inset-x-0 top-[42%] z-[2] flex -translate-y-1/2 justify-center px-6"
          >
            <Link
              href={video.fullVideoHref}
              aria-label={C.verCompletoLabel(title)}
              className={cn(
                "pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full bg-on-media px-5",
                "font-display text-sm font-bold text-media-shade shadow-[0_8px_24px_rgba(0,0,0,0.22)]",
                "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.96]",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60",
              )}
            >
              <Play size={16} weight="fill" aria-hidden="true" />
              {C.verCompleto}
            </Link>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
