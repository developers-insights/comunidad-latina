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
  useCloseOnBack,
  useFocusTrap,
  useMounted,
} from "@/lib/design/use-overlay";
import { recordPostViewAction } from "@/app/(app)/feed/engagement-actions";
import { MuxVideoSurface } from "@/components/video/mux-player";
import type { PlayableMedia } from "@/components/video/playable-media";
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
 * - Desde el 2026-08-20 éste es TAMBIÉN el destino del toque sobre un video de
 *   la tarjeta del feed, que antes navegaba a `/videos` ("no te tiene que mover
 *   a otra publicación; ahí nomás dentro de pantalla se tiene que fluir sin
 *   sacarte del feed"). Eso trajo dos exigencias nuevas al contrato de open():
 *   heredar el segundo en el que venía el video (`startSeconds`) y avisar
 *   cuando el visor se cierra (`onClose`), para que la tarjeta retome sola.
 * - Cierre por historial: al abrir se apila una entrada, así el gesto/botón
 *   "atrás" del teléfono cierra el visor en vez de sacarte de la página. Desde
 *   el 2026-08-20 ese par pushState/popstate ya no vive acá: es
 *   `useCloseOnBack`, compartido con las tres hojas nuevas (publicación,
 *   comentarios, entrar), que no lo tenían y por eso el "atrás" se llevaba la
 *   pantalla entera. El comportamiento del visor no cambia; lo que cambia es
 *   que ahora, apilado con una hoja encima, el "atrás" cierra de a UNA.
 * - Cierre por ARRASTRE hacia abajo: el gesto que ya espera cualquiera que usó
 *   una galería de teléfono. Convive con el swipe horizontal porque motion pone
 *   `touch-action: pan-x` en un draggable de eje Y — el scroll-snap lateral
 *   sigue siendo nativo y el gesto vertical llega a motion.
 */

/**
 * Ventana para distinguir un toque simple de un doble toque sobre el video.
 * MISMO valor que card-post-media/card-video: la gramática táctil de la app es
 * una sola. Sólo se activa si quien monta el video pide `onDoubleTap` (los
 * reels): en el visor de fotos el play/pausa sigue siendo instantáneo.
 */
const DOUBLE_TAP_MS = 250;

/** Arrastre mínimo (px) o velocidad (px/s) hacia abajo para cerrar el visor. */
const DISMISS_OFFSET = 110;
const DISMISS_VELOCITY = 600;

export interface ViewerMediaItem {
  kind: PostMediaKind;
  url: string;
  /**
   * Video alojado en Mux. Presente = se reproduce con el reproductor de Mux
   * (HLS adaptativo) y `url` es sólo la miniatura; ausente —el caso de siempre,
   * y el de los 36 videos que ya estaban en el bucket— = `url` es el archivo y
   * se reproduce con el `<video>` de toda la vida.
   */
  muxPlaybackId?: string | null;
  /**
   * Primer cuadro del video capturado al subir (0132), ya como URL pública. El
   * visor lo usa de `poster`: abrir a pantalla completa un `.mp4` crudo sin
   * poster deja un rectángulo negro hasta que baja la metadata, justo en el
   * momento en que la persona acaba de tocar y está mirando.
   */
  posterUrl?: string | null;
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
  /**
   * TOPE DE REPRODUCCIÓN de la superficie, en segundos. Lo calcula quien abre
   * (ver `viewerPlaybackCapFor` en helpers.ts, que lo saca de video-policy):
   * 600 s dentro de un anuncio, 300 s en el detalle de una publicación. Sin
   * valor, el video se reproduce entero.
   */
  maxPlaybackSeconds?: number | null;
  /**
   * SEGUNDO EN EL QUE VENÍA el video que se tocó. Existe por el pedido del
   * cliente del 2026-08-20 ("ahí nomás dentro de pantalla se tiene que fluir
   * sin sacarte del feed"): un video que ya estaba corriendo en la tarjeta y
   * vuelve a empezar de cero al abrirse es un salto, no una continuación.
   *
   * Se aplica UNA vez y sólo al medio de entrada (`startIndex`): pasar a la
   * foto de al lado y volver no vuelve a saltar, porque a esa altura el reloj
   * del video ya es del visor y no de la tarjeta.
   */
  startSeconds?: number;
  /**
   * Aviso de CIERRE, por el camino que sea (la X, Escape, el "atrás" del
   * teléfono o el arrastre hacia abajo). No es un detalle de ciclo de vida: la
   * tarjeta del feed pausa su propio video antes de abrir —dos copias del mismo
   * clip sonando juntas es un desastre— y sin este aviso se quedaba congelada
   * en el frame donde la pausamos. El observador de visibilidad no la despierta
   * porque la card nunca dejó de estar a la vista: el visor es un overlay, no
   * una navegación.
   */
  onClose?: () => void;
}

interface MediaViewerContextValue {
  open: (args: OpenMediaViewerArgs) => void;
  /**
   * ¿Hay un provider REAL montado? El fallback del hook es un no-op silencioso
   * —lo correcto para que ninguna card rompa fuera del provider—, pero para
   * quien depende del visor como acción PRINCIPAL eso sería un toque muerto.
   * Leyendo esto, el video de la tarjeta puede caer a su camino de siempre
   * (`/videos`) en vez de no hacer nada.
   */
  available: boolean;
}

const MediaViewerContext = createContext<MediaViewerContextValue | null>(null);

/** Hook de las cards. Fuera del provider devuelve un no-op (nunca rompe). */
export function useMediaViewer(): MediaViewerContextValue {
  const fallback = useMemo<MediaViewerContextValue>(
    () => ({ open: () => undefined, available: false }),
    [],
  );
  return useContext(MediaViewerContext) ?? fallback;
}

export function MediaViewerProvider({ children }: { children: ReactNode }) {
  const [args, setArgs] = useState<OpenMediaViewerArgs | null>(null);
  /**
   * El `onClose` de la apertura vigente. Vive en una ref y no en el estado
   * porque los dos caminos de cierre —la UI y el `popstate`— corren fuera del
   * render, y porque el aviso tiene que entregarse UNA sola vez salga por donde
   * salga el visor.
   */
  const closeNotifier = useRef<(() => void) | null>(null);

  const notifyClosed = useCallback(() => {
    const notify = closeNotifier.current;
    closeNotifier.current = null;
    notify?.();
  }, []);

  const open = useCallback(
    (next: OpenMediaViewerArgs) => {
      if (!next.items || next.items.length === 0) return;
      // Abrir sobre un visor ya abierto igual cierra al anterior: su dueño tiene
      // que enterarse, o se queda esperando un aviso que no va a llegar.
      notifyClosed();
      closeNotifier.current = next.onClose ?? null;
      setArgs(next);
    },
    [notifyClosed],
  );

  /**
   * Un solo cierre para los cuatro caminos (la X, Escape, el arrastre y el
   * "atrás" del teléfono): el visor se va YA —la salida no puede sentirse
   * lenta— y quien lo abrió se entera una sola vez. La contabilidad del
   * historial la lleva `useCloseOnBack`, que sabe además que puede haber otras
   * capas abiertas y no tiene que llevárselas puestas.
   */
  const close = useCallback(() => {
    setArgs(null);
    notifyClosed();
  }, [notifyClosed]);

  useCloseOnBack(args !== null, close);

  const value = useMemo(() => ({ open, available: true }), [open]);

  return (
    <MediaViewerContext.Provider value={value}>
      {children}
      <MediaViewerOverlay args={args} onClose={close} />
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
  /**
   * El medio POR EL QUE SE ENTRÓ. Es el único que hereda el reloj de la
   * superficie que abrió (`startSeconds`): si la persona pasa a la foto de al
   * lado y vuelve, el video ya está en su propia línea de tiempo y volver a
   * saltar sería un corte, no una continuación.
   *
   * Estado y no ref: se lee DURANTE el render (elige a qué diapositiva le baja
   * el segundo heredado) y una ref leída en render es exactamente lo que
   * prohíbe `react-hooks/refs`. Sin setter, es un valor congelado al montar.
   */
  const [entryIndex] = useState(index);

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

  // Vista de video: cuando el medio activo es un video Y sabemos de qué post
  // viene, se registra UNA vez por post mientras el visor esté abierto (volver
  // al mismo video pasando de foto y atrás no vuelve a contar). Fire-and-forget:
  // nunca bloquea ni rompe la reproducción.
  const viewedPostIds = useRef<Set<string>>(new Set());
  const activeKind = args.items[index]?.kind;
  const postId = args.postId;
  useEffect(() => {
    if (activeKind !== "video" || !postId) return;
    if (viewedPostIds.current.has(postId)) return;
    viewedPostIds.current.add(postId);
    void recordPostViewAction({ postId }).catch(() => undefined);
  }, [activeKind, postId]);

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
      // Arrastrar hacia abajo cierra (gesto estándar de galería). Con
      // reduced-motion se desactiva: la X y el "atrás" siguen siendo el camino.
      // El eje Y deja intacto el swipe horizontal entre medios (touch-action:
      // pan-x); si el arrastre no alcanza el umbral, vuelve solo a su lugar.
      drag={reduceMotion ? false : "y"}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.08, bottom: 0.7 }}
      onDragEnd={(_, info) => {
        if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) {
          onClose();
        }
      }}
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
                muxPlaybackId={item.muxPlaybackId}
                active={itemIndex === index}
                muted={muted}
                onMutedChange={setMuted}
                authorLabel={authorLabel}
                maxPlaybackSeconds={args.maxPlaybackSeconds}
                startSeconds={
                  itemIndex === entryIndex ? args.startSeconds : undefined
                }
                posterUrl={item.posterUrl}
                // El visor abre porque alguien tocó: este video SE VA A VER.
                // `metadata` acá sería pedirle a la persona que espere dos veces
                // (una para saber que hay video, otra para verlo).
                preload={itemIndex === index ? "auto" : "metadata"}
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
function safePlay(video: PlayableMedia, onRejected?: () => void) {
  try {
    const result = video.play() as Promise<void> | undefined;
    result?.catch(() => onRejected?.());
  } catch {
    onRejected?.();
  }
}

export interface ViewerVideoProps {
  url: string;
  /** Ver `ViewerMediaItem.muxPlaybackId`. Ausente = archivo del bucket. */
  muxPlaybackId?: string | null;
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
  /**
   * Doble toque sobre el video (los reels: me gusta). Al pasarlo, el toque
   * simple de play/pausa espera la ventana de doble-tap; sin él, el play/pausa
   * responde al instante (visor de fotos).
   */
  onDoubleTap?: () => void;
  /** Clases extra de la barra inferior (p.ej. despejar el bottom nav en reels). */
  controlsClassName?: string;
  /**
   * TOPE DE REPRODUCCIÓN de esta superficie, en segundos (ver
   * `src/lib/media/video-policy.ts`). Al llegar, el video vuelve al principio en
   * vez de seguir. Es lo que hace que "Videos Cortos" siga siendo corto aunque
   * un archivo viejo dure más de lo que declara —los 7 videos anteriores a la
   * 0046 no tienen duración conocida—, y lo que sostiene la vista previa del
   * feed. Sin tope (undefined) el video se reproduce entero: es el caso del
   * detalle de una publicación, donde se ve completo.
   */
  maxPlaybackSeconds?: number | null;
  /**
   * SEGUNDO DEL QUE ARRANCA, cuando el video venía reproduciéndose en la
   * superficie que abrió el visor (la tarjeta del feed). Se aplica una sola vez,
   * al primer play de este elemento.
   */
  startSeconds?: number;
  /**
   * PRIMER CUADRO DEL VIDEO, capturado al subir (0132). Lo que se pinta mientras
   * el archivo del bucket todavía no llegó.
   *
   * Es la mitad visible del arreglo del "sale en blanco" (cliente 2026-09-03,
   * 1:07:00): sin poster, un `.mp4` crudo no tiene NADA que mostrar hasta que
   * baja su metadata, y eso en 4G son segundos de rectángulo vacío. La otra
   * mitad es `preload`, acá abajo.
   *
   * Ausente = el video no tiene poster (los anteriores a la 0132, o un archivo
   * que el navegador no pudo decodificar al subir). Ahí manda el respaldo de la
   * superficie, que nunca es blanco.
   */
  posterUrl?: string | null;
  /**
   * CUÁNTO SE BAJA ANTES DE QUE ALGUIEN TOQUE PLAY. Default `"metadata"`: sólo
   * la cabecera, que es lo correcto para un video que quizá nadie mire.
   *
   * El reel pasa `"auto"` al video ACTIVO y al SIGUIENTE —los dos que se van a
   * ver seguro— y deja el resto en `"metadata"`. Es el otro lado del pedido del
   * cliente: el poster tapa la espera del video que ya estás viendo; la precarga
   * hace que el de abajo no tenga espera cuando llegues.
   *
   * Sólo aplica al `<video>` del bucket: el reproductor de Mux maneja su propio
   * buffer de HLS y no expone esta palanca (ni la necesita).
   */
  preload?: "none" | "metadata" | "auto";
  className?: string;
}

export function ViewerVideo({
  url,
  muxPlaybackId = null,
  active,
  muted,
  onMutedChange,
  authorLabel,
  fit = "contain",
  showMute = true,
  onDoubleTap,
  controlsClassName,
  maxPlaybackSeconds,
  startSeconds,
  posterUrl,
  preload = "metadata",
  className,
}: ViewerVideoProps) {
  /**
   * Dejó de ser `HTMLVideoElement`: con Mux el elemento es un custom element que
   * no hereda de él, pero cumple el mismo contrato mínimo (`PlayableMedia`) y
   * eso es todo lo que este visor le pide — arrancar, pausar, mover el reloj,
   * mutear, y decir si está en pausa y qué tamaño tiene el cuadro.
   */
  const videoRef = useRef<PlayableMedia | null>(null);
  const usaMux = Boolean(muxPlaybackId);
  /**
   * El reproductor de Mux existe (se carga en diferido, ver `mux-player.tsx`).
   * Entra en las dependencias del efecto que reproduce: sin esto, el efecto
   * corre con `videoRef.current` en null y el video de un reel se quedaría
   * quieto en su miniatura, sin que nada vuelva a intentarlo.
   */
  const [muxMontado, setMuxMontado] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const tapTimer = useRef<number | null>(null);
  /** El salto de continuidad se hace UNA vez; después manda el reloj del visor. */
  const seeded = useRef(false);
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
    // CONTINUIDAD antes del play: el video sigue donde venía en vez de volver al
    // segundo cero. Se escribe aunque la metadata no haya cargado todavía —el
    // navegador guarda la posición y arranca ahí— y una sola vez, para que
    // volver a este medio desde otra diapositiva no rebobine.
    if (!seeded.current) {
      seeded.current = true;
      if (typeof startSeconds === "number" && startSeconds > 0) {
        try {
          video.currentTime = startSeconds;
        } catch {
          // Sin reloj disponible: arranca del principio, que es lo honesto.
        }
      }
    }
    safePlay(video, () => {
      // Autoplay con audio bloqueado → caemos a mudo (y el toggle queda visible).
      onMutedChange(true);
      video.muted = true;
      safePlay(video);
    });
  }, [active, muted, onMutedChange, startSeconds, muxMontado]);

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
  // Y, si la superficie tiene tope, es acá donde se aplica: `timeupdate` es el
  // único punto que ve el reloj del video sin montar un intervalo propio.
  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    const bar = progressRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration === 0) return;

    const cap =
      typeof maxPlaybackSeconds === "number" && maxPlaybackSeconds > 0
        ? Math.min(maxPlaybackSeconds, video.duration)
        : video.duration;

    if (video.currentTime >= cap) {
      // `loop` ya está puesto: volver a 0 continúa reproduciendo sin cortes.
      video.currentTime = 0;
      if (bar) bar.style.width = "0%";
      return;
    }
    // La barra mide la VENTANA que se está mostrando, no el archivo: si el tope
    // corta a los 59 s, llenarla hasta el final del archivo mentiría dos veces
    // (parecería que falta mucho, y saltaría antes de llegar).
    if (bar) bar.style.width = `${(video.currentTime / cap) * 100}%`;
  }, [maxPlaybackSeconds]);

  // Un toque en vuelo cuando el slide se desmonta (scroll rápido del reel) no
  // puede pausar un video que ya no está.
  useEffect(
    () => () => {
      if (tapTimer.current !== null) clearTimeout(tapTimer.current);
    },
    [],
  );

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      safePlay(video);
    } else {
      video.pause();
    }
  }

  function handleTap() {
    // Sin doble-tap configurado (visor de fotos): play/pausa INMEDIATO.
    if (!onDoubleTap) {
      togglePlay();
      return;
    }
    if (tapTimer.current !== null) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      onDoubleTap();
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      togglePlay();
    }, DOUBLE_TAP_MS);
  }

  /**
   * CÓMO ENTRA EL CUADRO EN LA PANTALLA. Una sola cuenta para los dos
   * elementos, porque la regla es la misma: `cover` sólo si la superficie lo
   * pidió Y el video es vertical. Uno horizontal recortado a `cover` en un reel
   * quedaría partido al medio, así que ése siempre va entero, con bandas.
   */
  const ajuste: "cover" | "contain" =
    fit === "cover" && !isLandscape ? "cover" : "contain";

  return (
    <div className={cn("relative h-full w-full", className)}>
      {usaMux && muxPlaybackId ? (
        <MuxVideoSurface
          playbackId={muxPlaybackId}
          mediaRef={videoRef}
          // `fill`: acá la caja la define la pantalla (el visor, el reel), no un
          // 4:5 como en la tarjeta del feed.
          layout="fill"
          objectFit={ajuste}
          muted={muted}
          loop
          // Igual que con el `<video>`: quien decide cuándo arranca es el efecto
          // de arriba, que además sabe caer a mudo si el navegador bloquea el
          // autoplay con sonido. Dos criterios de arranque serían dos bugs.
          autoPlay={false}
          ariaLabel={authorLabel ? VIEWER_COPY.videoLabel(authorLabel) : undefined}
          onReady={() => setMuxMontado(true)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={() => {
            const el = videoRef.current;
            if (el?.videoWidth && el?.videoHeight) {
              setIsLandscape(el.videoWidth > el.videoHeight);
            }
          }}
        />
      ) : (
        <video
          ref={videoRef as React.RefObject<HTMLVideoElement | null>}
          src={url}
          playsInline
          loop
          preload={preload}
          // Cadena vacía → sin atributo: un `poster=""` es una imagen rota, y el
          // navegador se queda con ella en vez de mostrar el primer cuadro.
          poster={posterUrl || undefined}
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
          className={cn("h-full w-full", ajuste === "cover" ? "object-cover" : "object-contain")}
        />
      )}

      {/* Tap en el video = play/pausa (targets grandes, sin controles nativos) */}
      <button
        type="button"
        onClick={handleTap}
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
