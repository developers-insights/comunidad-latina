"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { Play, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import {
  useBodyScrollLock,
  useFocusTrap,
  useMounted,
} from "@/lib/design/use-overlay";
import type { PostMediaKind } from "./helpers";
import { VIEWER_COPY } from "./viewer-copy";

/**
 * Visor de medios a pantalla completa (feedback cliente 2026-07-21: "le das
 * clic a la foto y se abre, puedes pasar las fotos, y si hay un video le das
 * play"). Las cards llaman `useMediaViewer().open(...)`; el provider montado
 * en el layout de la app renderiza el visor.
 *
 * Decisiones:
 * - Swipe horizontal con scroll-snap NATIVO (no drag de motion): el gesto es
 *   del sistema, va a 60fps y respeta el momentum de cada plataforma.
 * - Los videos arrancan CON SONIDO al abrir: abrir el visor ES un gesto del
 *   usuario, así que el autoplay con audio es legal — y es lo que pidió el
 *   cliente. Si el navegador igual lo rechaza (políticas raras de WebView),
 *   caemos a mudo y el botón de sonido queda a un tap.
 * - Cierre por historial: al abrir se apila una entrada, así el gesto/botón
 *   "atrás" del teléfono cierra el visor en vez de sacarte de la página.
 */

export interface ViewerMediaItem {
  kind: PostMediaKind;
  url: string;
}

export interface OpenMediaViewerArgs {
  /** Medios del post en orden; el visor permite pasar entre ellos. */
  items: ViewerMediaItem[];
  /** Índice del ítem tocado (default 0). */
  startIndex?: number;
  /** Post de origen — habilita acciones contextuales (like, comentarios). */
  postId?: string;
  /** Nombre visible del autor para el encabezado del visor. */
  authorName?: string;
}

interface MediaViewerContextValue {
  open: (args: OpenMediaViewerArgs) => void;
}

const MediaViewerContext = createContext<MediaViewerContextValue | null>(null);

/** Hook de las cards. Fuera del provider devuelve un no-op (nunca rompe). */
export function useMediaViewer(): MediaViewerContextValue {
  const fallback = useMemo<MediaViewerContextValue>(
    () => ({ open: () => undefined }),
    [],
  );
  return useContext(MediaViewerContext) ?? fallback;
}

export function MediaViewerProvider({ children }: { children: ReactNode }) {
  const [args, setArgs] = useState<OpenMediaViewerArgs | null>(null);
  // ¿Apilamos una entrada de historial por este visor? El "atrás" del teléfono
  // la consume y cierra; si cerramos por UI (X/Escape) la consumimos nosotros.
  const pushedHistory = useRef(false);
  const suppressNextPop = useRef(false);

  const open = useCallback((next: OpenMediaViewerArgs) => {
    if (!next.items || next.items.length === 0) return;
    setArgs(next);
    try {
      window.history.pushState({ clMediaViewer: true }, "");
      pushedHistory.current = true;
    } catch {
      pushedHistory.current = false; // sin historial (SSR raro): X/Escape siguen cerrando
    }
  }, []);

  // Cierre iniciado por la UI (X, Escape): cerramos YA (la salida no puede
  // sentirse lenta) y consumimos la entrada de historial en silencio.
  const closeFromUi = useCallback(() => {
    setArgs(null);
    if (pushedHistory.current) {
      pushedHistory.current = false;
      suppressNextPop.current = true;
      try {
        window.history.back();
      } catch {
        suppressNextPop.current = false;
      }
    }
  }, []);

  // Cierre por gesto/botón atrás: el navegador ya sacó la entrada, solo cerramos.
  useEffect(() => {
    if (!args) return;
    function onPopState() {
      if (suppressNextPop.current) {
        suppressNextPop.current = false;
        return;
      }
      pushedHistory.current = false;
      setArgs(null);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [args]);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <MediaViewerContext.Provider value={value}>
      {children}
      <MediaViewerOverlay args={args} onClose={closeFromUi} />
    </MediaViewerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Overlay (portal + animación de entrada/salida)
// ---------------------------------------------------------------------------

function MediaViewerOverlay({
  args,
  onClose,
}: {
  args: OpenMediaViewerArgs | null;
  onClose: () => void;
}) {
  const mounted = useMounted();
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {args && <ViewerPanel key="media-viewer" args={args} onClose={onClose} />}
    </AnimatePresence>,
    document.body,
  );
}

function ViewerPanel({
  args,
  onClose,
}: {
  args: OpenMediaViewerArgs;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(args.startIndex ?? 0, 0), args.items.length - 1),
  );
  // Sonido global del visor: arranca ENCENDIDO (hubo gesto); si el navegador
  // rechaza el play con audio, cae a mudo y el toggle queda a mano.
  const [muted, setMuted] = useState(false);

  useFocusTrap(panelRef, true, onClose);
  useBodyScrollLock(true);

  const total = args.items.length;
  const authorLabel = args.authorName?.trim() || null;

  // Posicionar el carrusel en el ítem tocado ANTES del primer paint.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollLeft = index * track.clientWidth;
    // Solo al montar: después manda el scroll del usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Índice actual desde el scroll (snap → clientWidth exacto por slide).
  const onTrackScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const next = Math.round(track.scrollLeft / track.clientWidth);
    setIndex((current) => (current === next ? current : next));
  }, []);

  const scrollToIndex = useCallback((next: number) => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.min(Math.max(next, 0), track.children.length - 1);
    track.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" });
  }, []);

  // Flechas del teclado (desktop): pasar de medio sin soltar el mouse.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") scrollToIndex(index + 1);
      if (event.key === "ArrowLeft") scrollToIndex(index - 1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, scrollToIndex]);

  return (
    <m.div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={
        authorLabel
          ? VIEWER_COPY.dialogLabel(authorLabel)
          : VIEWER_COPY.dialogLabelAnonymous
      }
      tabIndex={-1}
      className="cl-print-hide fixed inset-0 z-[60] bg-media-shade"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: 0.15 } }
          : { opacity: 0, scale: 0.98, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }
      }
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
    >
      {/* Carrusel: un slide por medio, snap nativo */}
      <div
        ref={trackRef}
        onScroll={onTrackScroll}
        className={cn(
          "flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-contain",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {args.items.map((item, itemIndex) => (
          <div
            key={`${item.url}-${itemIndex}`}
            role="group"
            aria-roledescription="medio"
            aria-label={VIEWER_COPY.counterLabel(itemIndex + 1, total)}
            className="relative flex h-full w-full shrink-0 snap-center items-center justify-center"
          >
            {item.kind === "video" ? (
              <ViewerVideo
                url={item.url}
                active={itemIndex === index}
                muted={muted}
                onMutedChange={setMuted}
                authorLabel={authorLabel}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- visor fullscreen: URL pública del bucket, sin optimizador
              <img
                src={item.url}
                alt={authorLabel ? VIEWER_COPY.photoAlt(authorLabel) : ""}
                className="max-h-full max-w-full object-contain"
                draggable={false}
              />
            )}
          </div>
        ))}
      </div>

      {/* Encabezado sobre degradado de legibilidad (tokens de media, AA) */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-media-shade/80 to-transparent",
          "pb-8 pl-4 pr-3 pt-[max(env(safe-area-inset-top),0.625rem)]",
        )}
      >
        <div className="mx-auto flex w-full max-w-lg items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-on-media">
            {authorLabel}
          </p>
          {total > 1 && (
            <span
              aria-live="polite"
              aria-label={VIEWER_COPY.counterLabel(index + 1, total)}
              className="numeric shrink-0 rounded-full bg-media-scrim px-2.5 py-1 text-xs font-semibold text-on-media"
            >
              {index + 1}/{total}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={VIEWER_COPY.close}
            className={cn(
              "pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-full bg-media-scrim text-on-media",
              "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.92]",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60",
            )}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
    </m.div>
  );
}

// ---------------------------------------------------------------------------
// Video del visor: autoplay con sonido al abrir, tap = play/pausa, mute,
// barra de progreso mínima. El MISMO componente que reutiliza /videos.
// ---------------------------------------------------------------------------

/**
 * `play()` puede devolver una promesa rechazada (política de autoplay) o
 * `undefined` (jsdom / navegadores viejos): el fallback silencioso cubre ambos.
 */
function safePlay(video: HTMLVideoElement, onRejected?: () => void) {
  try {
    const result = video.play() as Promise<void> | undefined;
    result?.catch(() => onRejected?.());
  } catch {
    onRejected?.();
  }
}

export interface ViewerVideoProps {
  url: string;
  /** Solo el slide activo reproduce; los demás quedan en pausa. */
  active: boolean;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  authorLabel?: string | null;
  /**
   * Ajuste del video en su caja. "cover" (reels) solo se aplica a videos
   * VERTICALES: uno horizontal subido por un usuario caería recortado de
   * forma brutal, así que ese cae a contain con bandas.
   */
  fit?: "contain" | "cover";
  /** Oculta el toggle de sonido (los reels lo ponen en su propio riel). */
  showMute?: boolean;
  /** Clases extra de la barra inferior (p.ej. despejar el bottom nav en reels). */
  controlsClassName?: string;
  className?: string;
}

export function ViewerVideo({
  url,
  active,
  muted,
  onMutedChange,
  authorLabel,
  fit = "contain",
  showMute = true,
  controlsClassName,
  className,
}: ViewerVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(!active);
  const [isLandscape, setIsLandscape] = useState(false);

  // Reproducir/pausar según visibilidad del slide. Con sonido primero (hubo
  // gesto del usuario); si el navegador lo rechaza, mudo y reintento.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active) {
      video.pause();
      return;
    }
    video.muted = muted;
    safePlay(video, () => {
      // Autoplay con audio bloqueado → caemos a mudo (y el toggle queda visible).
      onMutedChange(true);
      video.muted = true;
      safePlay(video);
    });
  }, [active, muted, onMutedChange]);

  // Con la pestaña oculta el video se pausa; al volver, si sigue activo,
  // retoma solo (cortesía estándar de reproductores móviles).
  useEffect(() => {
    function onVisibilityChange() {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) {
        video.pause();
      } else if (active) {
        safePlay(video);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [active]);

  // Barra de progreso sin re-render por frame: se escribe el style directo.
  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    const bar = progressRef.current;
    if (!video || !bar || !Number.isFinite(video.duration) || video.duration === 0) return;
    bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
  }, []);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      safePlay(video);
    } else {
      video.pause();
    }
  }

  return (
    <div className={cn("relative h-full w-full", className)}>
      <video
        ref={videoRef}
        src={url}
        playsInline
        loop
        preload="metadata"
        aria-label={
          authorLabel ? VIEWER_COPY.videoLabel(authorLabel) : undefined
        }
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={(event) => {
          const el = event.currentTarget;
          setIsLandscape(el.videoWidth > el.videoHeight);
        }}
        className={cn(
          "h-full w-full",
          fit === "cover" && !isLandscape ? "object-cover" : "object-contain",
        )}
      />

      {/* Tap en el video = play/pausa (targets grandes, sin controles nativos) */}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={paused ? VIEWER_COPY.play : VIEWER_COPY.pause}
        className="absolute inset-0 z-[1] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-on-media/60"
      >
        {/* Ícono central solo en pausa: en reproducción la imagen manda. */}
        {paused && (
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-media-scrim text-on-media"
          >
            <Play size={30} weight="fill" />
          </span>
        )}
      </button>

      {/* Controles inferiores: progreso (+ sonido en el visor) */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-media-shade/75 to-transparent pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-10",
          controlsClassName,
        )}
      >
        <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-4">
          <div
            aria-hidden="true"
            className="h-1 flex-1 overflow-hidden rounded-full bg-on-media/25"
          >
            <div ref={progressRef} className="h-full w-0 rounded-full bg-on-media" />
          </div>
          {showMute && (
            <button
              type="button"
              onClick={() => onMutedChange(!muted)}
              aria-label={muted ? VIEWER_COPY.unmute : VIEWER_COPY.mute}
              aria-pressed={!muted}
              className={cn(
                "pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-full bg-media-scrim text-on-media",
                "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.92]",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60",
              )}
            >
              {muted ? (
                <SpeakerSlash size={20} aria-hidden="true" />
              ) : (
                <SpeakerHigh size={20} aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
