"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { m, useReducedMotion } from "motion/react";
import { X } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import {
  useBodyScrollLock,
  useCloseOnBack,
  useFocusTrap,
  useMounted,
} from "@/lib/design/use-overlay";
import { openReelAtPostAction, type ReelOverlayPage } from "./actions";
import { parseVideosScope } from "./helpers";
import { ReelStream } from "./video-reels";
import { VIDEOS_COPY } from "./copy";

/**
 * EL REEL, ENCIMA DEL FEED (cliente 2026-09-03, 17:23–18:20).
 *
 * ─── QUÉ PEDÍA EL CLIENTE ──────────────────────────────────────────────────
 * «Ahí no te sale la música… debería hacer scrolling los videos.» Nacho, en la
 * misma call: «cuando apretás en el post no hay scrolling, no te llevan los
 * otros videos cortos».
 *
 * ─── POR QUÉ NO ALCANZABA CON LO QUE HABÍA ─────────────────────────────────
 * Había DOS cosas, y ninguna era ésta:
 *
 *  · `/videos?start=` ES el reel con scroll, pero se llega NAVEGANDO. Eso es
 *    justo lo que el cliente había pedido sacar el 2026-08-20 ("no te tiene que
 *    mover a otra publicación… si no es como que te corta el mambo"): volver
 *    costaba un "atrás" que perdía el scroll del feed.
 *  · El visor a pantalla completa (`media-viewer`) se abre encima y devuelve al
 *    mismo lugar, pero es un CARRUSEL de los medios de UNA publicación: no monta
 *    la música (vive en la card) y no lleva a ningún otro video.
 *
 * Los dos pedidos no se contradicen: uno es sobre PERDER EL LUGAR y el otro
 * sobre PODER SEGUIR VIENDO. Esta pantalla cumple los dos — el reel completo,
 * con su música y su scroll infinito, montado como overlay sobre el feed. Al
 * cerrar, el feed sigue exactamente donde estaba (nunca hubo navegación) y la
 * tarjeta retoma su video con `resumeAfterViewer`.
 *
 * ─── UN SOLO REEL, DOS MARCOS ──────────────────────────────────────────────
 * El contenido no se duplica: `ReelStream` es el mismo componente que pinta la
 * sección `/videos`, con los mismos slides, el mismo scroll infinito contra la
 * misma server action y las mismas reglas de elegibilidad. Lo único de este
 * archivo es el MARCO: el overlay, la salida y el gesto para cerrarlo. Si el
 * reel de la sección mejora, éste mejora igual.
 */

/** Arrastre mínimo (px) hacia abajo para cerrar. Mismo valor que el visor. */
const DISMISS_OFFSET = 110;
/**
 * Cuánto hay que moverse antes de que el gesto deje de ser "un roce" y pase a
 * ser un arrastre. Sin esto, un toque con el pulgar apenas inclinado empieza a
 * despegar el overlay y se siente flojo.
 */
const DRAG_SLOP = 12;
/**
 * Resistencia del arrastre: el panel sigue al dedo al 70 %. Es lo que hace que
 * se sienta un objeto con peso y no una capa pegada al dedo — el mismo criterio
 * que el `dragElastic` del visor de fotos.
 */
const DRAG_RESISTANCE = 0.7;

export interface ReelOverlayProps {
  /** Publicación por la que se entra: el reel arranca en ese video. */
  postId: string;
  /** Scope del feed que montó la tarjeta. El servidor lo re-valida. */
  scope: string;
  /** La X, Escape, el "atrás" del teléfono o el arrastre hacia abajo. */
  onClose: () => void;
  /**
   * EL REEL NO TIENE NADA QUE MOSTRAR para este post.
   *
   * Pasa cuando el post dejó de ser elegible entre que el feed se pintó y el
   * dedo tocó (se despublicó, entró a revisión, lo bloquearon), o cuando la
   * consulta falla. En vez de dejar un reel vacío —que se lee como "se rompió"—
   * se avisa y quien abrió cae a su camino de siempre: el visor de la propia
   * publicación.
   */
  onUnavailable: () => void;
}

export function ReelOverlay({ postId, scope, onClose, onUnavailable }: ReelOverlayProps) {
  const mounted = useMounted();
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<ReelOverlayPage | null>(null);

  useFocusTrap(panelRef, true, onClose);
  useBodyScrollLock(true);
  useCloseOnBack(true, onClose);

  /**
   * LA PRIMERA TANDA. Se pide al montar, con el post tocado de cabecera. Es la
   * MISMA función que resuelve `/videos?start=` en el servidor, así que el reel
   * que se abre desde el feed y el de la sección no pueden mostrar cosas
   * distintas.
   *
   * `cancelado` evita el setState sobre un overlay que la persona ya cerró: la
   * consulta puede tardar más que el gesto de cerrar.
   */
  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const result = await openReelAtPostAction({ scope, startId: postId });
        if (cancelado) return;
        if (result.items.length === 0) {
          onUnavailable();
          return;
        }
        setPage(result);
      } catch (error) {
        if (cancelado) return;
        // Se LOGUEA y se cae al visor: quedarse con un overlay negro vacío es
        // indistinguible de una app colgada.
        console.warn("[videos] no se pudo abrir el reel desde el feed", {
          message: error instanceof Error ? error.message : String(error),
        });
        onUnavailable();
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [postId, scope, onUnavailable]);

  /**
   * ---- ARRASTRAR HACIA ABAJO PARA VOLVER AL FEED -------------------------
   *
   * A mano, y NO con el `drag` de motion como hace el visor de fotos. La razón
   * es concreta: un draggable de eje Y de motion pone `touch-action: pan-x` en
   * el elemento y captura el puntero, o sea que se lleva puesto el scroll
   * VERTICAL del reel — que es exactamente lo que la persona vino a hacer acá.
   * En el visor de fotos no pasaba porque ahí el carrusel scrollea de costado.
   *
   * La regla que resuelve el conflicto es la misma que usan las apps de reels:
   * el gesto sólo cierra si el scroll YA ESTÁ ARRIBA DE TODO y el dedo va hacia
   * abajo. Si hay algo más arriba, ese mismo movimiento es scroll y no se toca.
   *
   * Se escribe el `transform` directo sobre el nodo (no un estado de React): es
   * un gesto a 60 fps y un re-render por frame lo haría sentir pegajoso.
   */
  const cerrarRef = useRef(onClose);
  // La ref se escribe en un efecto y no durante el render (regla
  // `react-hooks/refs`): el gesto de abajo se arma una sola vez y necesita
  // llamar SIEMPRE al `onClose` actual, no al que existía cuando se armó.
  useEffect(() => {
    cerrarRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // Con reduced-motion no hay arrastre: la X, Escape y el "atrás" del teléfono
    // siguen siendo el camino, igual que en el visor.
    if (reduce) return;
    const node = dragRef.current;
    if (!node) return;

    let startY: number | null = null;
    let arrastrando = false;
    let desdeArriba = false;
    let ultimoDelta = 0;

    const soltar = (transicion: boolean) => {
      node.style.transition = transicion
        ? "transform 220ms cubic-bezier(0.32, 0.72, 0, 1), opacity 220ms linear"
        : "";
      node.style.transform = "";
      node.style.opacity = "";
    };

    // Arrow y no `function`: una declaración hoisteada pierde el estrechamiento
    // de `node` (TypeScript no puede probar que no se llame antes del guard).
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const target = event.target as HTMLElement | null;
      const scroller = target?.closest?.("[data-reel-scroll]") as HTMLElement | null;
      // Sin scroller (todavía cargando) también cuenta como "arriba de todo".
      desdeArriba = !scroller || scroller.scrollTop <= 0;
      startY = event.touches[0].clientY;
      arrastrando = false;
      ultimoDelta = 0;
      node.style.transition = "";
    };

    const onTouchMove = (event: TouchEvent) => {
      if (startY === null || !desdeArriba) return;
      const delta = event.touches[0].clientY - startY;
      // Hacia arriba es scroll (el siguiente video), no un cierre a medias.
      if (delta <= 0) return;
      if (!arrastrando && delta < DRAG_SLOP) return;
      arrastrando = true;
      ultimoDelta = delta;
      // El gesto ya es nuestro: sin esto el navegador hace su rebote de
      // overscroll por debajo y el panel se mueve contra un fondo que también
      // se mueve.
      event.preventDefault();
      node.style.transform = `translate3d(0, ${delta * DRAG_RESISTANCE}px, 0)`;
      node.style.opacity = String(Math.max(0.45, 1 - delta / 520));
    };

    const onTouchEnd = () => {
      if (arrastrando && ultimoDelta > DISMISS_OFFSET) {
        // No se anima la vuelta: el overlay se va, y su salida la anima motion.
        cerrarRef.current();
        soltar(false);
      } else if (arrastrando) {
        soltar(true);
      }
      startY = null;
      arrastrando = false;
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    // `passive: false` es obligatorio: sin eso el `preventDefault` de arriba no
    // hace nada y el gesto compite con el rebote del navegador.
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd);
    node.addEventListener("touchcancel", onTouchEnd);
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [reduce]);

  if (!mounted) return null;

  return createPortal(
    <m.div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={VIDEOS_COPY.feedLabel}
      tabIndex={-1}
      className="cl-print-hide fixed inset-0 z-[60] bg-media-shade"
      // La apertura crece desde la tarjeta en vez de aparecer: es lo que hace
      // que se lea como "el video se agrandó" y no como "se abrió un modal".
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.15 } }
          : { opacity: 0, scale: 0.96, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }
      }
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
    >
      {/* La capa que sigue al dedo. Separada del `m.div` a propósito: motion
          controla el transform de aquél para entrar y salir, y dos dueños del
          mismo `transform` se pisan. */}
      <div ref={dragRef} className="h-full w-full will-change-transform">
        {page ? (
          <ReelStream
            tenantId={page.tenantId}
            viewerId={page.viewerId}
            // El mismo saneo que hace el servidor: "siguiendo" y "sin-reel"
            // son scopes del FEED que el reel no conoce, y los dos significan
            // acá lo mismo — todos los videos ("para-ti").
            scope={parseVideosScope(scope)}
            initialItems={page.items}
            initialCursor={page.nextCursor}
            surface="overlay"
          />
        ) : (
          <ReelOverlayLoading />
        )}
      </div>

      {/* La salida, arriba a la derecha y siempre presente — también mientras
          carga: si la consulta tarda, la persona tiene que poder volver. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-media-shade/80 to-transparent pb-8 pl-4 pr-3 pt-[max(env(safe-area-inset-top),0.625rem)]">
        <div className="mx-auto flex w-full max-w-lg justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label={VIDEOS_COPY.reel.close}
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
    </m.div>,
    document.body,
  );
}

/**
 * Mientras llega la primera tanda: la SILUETA del reel, no un spinner (§5.2).
 * Fondo con el degradado de marca —nunca negro plano— para que la espera se
 * lea como "ya viene" y no como "se rompió", que es exactamente la distinción
 * que el cliente no podía hacer cuando los videos salían en blanco.
 */
function ReelOverlayLoading() {
  return (
    <div
      aria-busy="true"
      aria-label={VIDEOS_COPY.title}
      className="h-full w-full bg-media-shade bg-[radial-gradient(115%_85%_at_50%_20%,var(--color-brand-900),var(--color-media-shade)_70%)]"
    >
      <div className="mx-auto flex h-full w-full max-w-lg animate-pulse flex-col justify-end px-4 pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-full bg-on-media/15" />
          <div className="h-3.5 w-36 rounded-full bg-on-media/15" />
        </div>
        <div className="mt-3 h-3 w-2/3 rounded-full bg-on-media/10" />
        <div className="mt-2 h-3 w-1/2 rounded-full bg-on-media/10" />
      </div>
    </div>
  );
}
