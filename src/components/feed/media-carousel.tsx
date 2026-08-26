"use client";

import { useCallback, useEffect, useRef } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { CardMedia } from "@/components/ui";
import { usePrefersReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";
import { CardVideo } from "./card-video";
import { CAROUSEL_COPY } from "./carousel-copy";
import { COPY } from "./copy";
import type { PostMediaView, PostMusicView, VideoScopeProp } from "./helpers";

/**
 * CARRUSEL de medios de un post (feedback cliente 2026-07-27: "tú ves en
 * Instagram que tiene tres punticos… puede ser un video, dos fotos… y a veces un
 * video, dos fotos y al final el video"; sobre si se pasa para arriba o para el
 * costado: "sería para el costado").
 *
 * Un post puede traer FOTOS Y VIDEOS MEZCLADOS en cualquier orden: cada medio es
 * una diapositiva del ancho completo de la card, y se pasa deslizando de costado.
 *
 * DECISIONES
 *
 * · Swipe con scroll-snap NATIVO, no un drag a mano. El gesto lo maneja el
 *   sistema: va a 60fps, respeta el momentum de cada plataforma, y sigue
 *   funcionando con trackpad, rueda horizontal y lector de pantalla. Un drag
 *   propio tendría que reimplementar todo eso peor. `snap-always` obliga a
 *   parar en cada medio: un manotazo pasa UNO, no cuatro (igual que Instagram).
 *
 * · Un solo medio ⇒ NO hay puntitos ni flechas. Nada de UI que no dice nada.
 *
 * · SOLO el medio visible reproduce. `active` baja hasta cada CardVideo, que
 *   pausa apenas deja de ser el activo — dos videos del mismo post no pueden
 *   sonar juntos, ni siquiera durante el swipe.
 *
 * · Un toque sobre una FOTO abre el visor global EN ESE MEDIO (regla global del
 *   proyecto: la foto es la foto). Dos toques dan me gusta, en cualquier
 *   diapositiva — el contrato de useCardLike no se toca. Sobre un VIDEO manda
 *   CardVideo, que ya tiene la misma gramática (toque = reel, doble = me gusta).
 *
 * ACCESIBILIDAD — los puntitos NO son controles, y es a propósito:
 *   Para ser tocables de verdad tendrían que medir 44px cada uno, o sea una
 *   franja de botones cruzando la parte baja de la foto, justo encima del área
 *   donde se dan los dos toques del me gusta. Se robarían el gesto principal de
 *   la card. Van `aria-hidden` como indicador de estado, y la navegación
 *   accesible queda resuelta por otros cuatro caminos que sí son reales:
 *     1. flechas ←/→ (el riel escucha el keydown que burbujea desde el medio
 *        enfocado, así que no suma una parada de tabulación por card);
 *     2. flechas visibles en pantallas con mouse fino, botones de 44px con
 *        etiqueta propia;
 *     3. cada diapositiva es un `group` con aria-label "Foto 2 de 3";
 *     4. una región `aria-live` canta el medio actual al cambiar.
 *   Además, la capa tocable de la diapositiva ACTIVA es el único punto de
 *   tabulación del medio: entrar al carrusel no obliga a pasar por N botones.
 */

/** Ventana para distinguir un toque simple de un doble toque (§3). */
const DOUBLE_TAP_MS = 250;

/**
 * Más de esto y los puntitos dejan de ser legibles (y de contarse de un vistazo):
 * a partir de acá el indicador pasa a ser numérico, "7/12".
 */
const MAX_DOTS = 6;

export interface MediaCarouselProps {
  /** Medios del post en orden; pueden ser fotos y videos mezclados. */
  items: PostMediaView[];
  /**
   * Índice visible. CONTROLADO: el dueño del estado es el contexto de medios de
   * la card, no este componente — la fila de acciones lee el mismo valor para
   * decidir la forma de la hoja de comentarios.
   */
  index: number;
  onIndexChange: (index: number) => void;
  postId: string;
  /** Nombre visible del autor/entidad — encabeza el riel para lectores. */
  authorName: string;
  /**
   * Contexto del feed de videos para el tap sobre un video. Tipado (y no
   * `string`) a propósito: es el mismo motivo por el que existe `VideoScopeProp`
   * —un scope inventado tiene que ser error de compilación, no un reel que cae
   * al catálogo entero en silencio—. Declararlo `string` acá volvía a ensanchar
   * el tipo justo en el punto donde el valor baja a CardVideo.
   */
  videoScope: VideoScopeProp;
  /** Vistas del post (píldora sobre los medios de video). */
  viewCount?: number;
  /** Toque simple sobre una FOTO: abre el visor global en ese índice. */
  onPhotoTap: (index: number) => void;
  /** Doble toque sobre una FOTO: me gusta (el video lo resuelve CardVideo). */
  onPhotoDoubleTap: () => void;
  /**
   * Toque simple sobre un VIDEO. Sin esto, CardVideo hace lo suyo (abrir el reel
   * de /videos). Con esto manda la card: fuera del feed no hay scroll infinito.
   */
  onVideoTap?: (index: number) => void;
  /** Clases extra de la fila de puntitos (p. ej. subirla sobre el CTA de campaña). */
  dotsClassName?: string;
  /**
   * Pista asociada al POST (0090), no a un medio en particular: si alguna
   * diapositiva es un video, baja hasta CardVideo para que la reproduzca
   * sincronizada. Ausente en un carrusel sin música.
   */
  music?: PostMusicView | null;
}

export function MediaCarousel({
  items,
  index,
  onIndexChange,
  postId,
  authorName,
  videoScope,
  viewCount = 0,
  onPhotoTap,
  onPhotoDoubleTap,
  onVideoTap,
  dotsClassName,
  music = null,
}: MediaCarouselProps) {
  const reduce = usePrefersReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const tapTimer = useRef<number | null>(null);

  const total = items.length;
  const isCarousel = total > 1;
  const groupLabel = authorName.trim()
    ? CAROUSEL_COPY.groupLabel(authorName)
    : CAROUSEL_COPY.groupLabelAnonymous;

  // Si la card se desmonta con un toque en vuelo (scroll rápido del feed), el
  // timer no puede abrir el visor de una card que ya no está.
  useEffect(
    () => () => {
      if (tapTimer.current !== null) clearTimeout(tapTimer.current);
    },
    [],
  );

  /**
   * Índice actual a partir del scroll. Cada diapositiva mide exactamente el ancho
   * del riel, así que la cuenta es exacta y no hace falta IntersectionObserver.
   * Se llama seguido durante el swipe: el padre usa `setIndex` directo y React
   * descarta el render cuando el valor no cambió.
   */
  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const next = Math.round(track.scrollLeft / track.clientWidth);
    onIndexChange(Math.min(Math.max(next, 0), total - 1));
  }, [onIndexChange, total]);

  /**
   * Listener NATIVO, no `onScroll` de React. Verificado en vivo (2026-07-27): el
   * `scroll` no burbujea, y sobre este riel —render de servidor, hidratado dentro
   * de la card— React no llegaba a despachar su handler: el índice se quedaba
   * clavado en 0 aunque el riel se moviera. De paso, `passive` le saca al scroll
   * la posibilidad de bloquear el hilo principal en un evento de alta frecuencia.
   */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.addEventListener("scroll", handleScroll, { passive: true });
    return () => track.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const scrollToIndex = useCallback(
    (next: number) => {
      const track = trackRef.current;
      // jsdom no implementa scrollTo: guardamos para no romper en tests.
      if (!track || typeof track.scrollTo !== "function") return;
      const clamped = Math.min(Math.max(next, 0), total - 1);
      track.scrollTo({
        left: clamped * track.clientWidth,
        behavior: reduce ? "auto" : "smooth",
      });
    },
    [reduce, total],
  );

  /**
   * Flechas del teclado. El handler vive en el RIEL y aprovecha que el evento
   * burbujea desde el medio enfocado: así el carrusel se maneja con ←/→ sin
   * sumar una parada de tabulación propia en cada card del feed.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!isCarousel) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      scrollToIndex(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      scrollToIndex(index - 1);
    }
  }

  /** Toque sobre una foto: uno abre el visor, dos dan me gusta. */
  function handlePhotoTap(slideIndex: number) {
    if (tapTimer.current !== null) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      onPhotoDoubleTap();
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      onPhotoTap(slideIndex);
    }, DOUBLE_TAP_MS);
  }

  function slideLabel(item: PostMediaView, slideIndex: number) {
    return item.kind === "video"
      ? CAROUSEL_COPY.videoAt(slideIndex + 1, total)
      : CAROUSEL_COPY.photoAt(slideIndex + 1, total);
  }

  return (
    <div className="group/carousel relative">
      <div
        ref={trackRef}
        data-carousel-track=""
        onKeyDown={handleKeyDown}
        role={isCarousel ? "group" : undefined}
        aria-roledescription={isCarousel ? CAROUSEL_COPY.roleDescription : undefined}
        aria-label={isCarousel ? groupLabel : undefined}
        className={cn(
          "flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain",
          // Barra de scroll fuera: el indicador de posición son los puntitos.
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {items.map((item, slideIndex) => {
          const active = slideIndex === index;
          return (
            <div
              key={`${item.url}-${slideIndex}`}
              role={isCarousel ? "group" : undefined}
              aria-roledescription={isCarousel ? CAROUSEL_COPY.slideRole : undefined}
              aria-label={isCarousel ? slideLabel(item, slideIndex) : undefined}
              className="relative w-full shrink-0 snap-start snap-always"
            >
              {item.kind === "video" ? (
                <CardVideo
                  src={item.url}
                  postId={postId}
                  scope={videoScope}
                  // Sólo para el encabezado del visor que abre el toque: sin
                  // esto su rótulo caía en "Fotos y videos de la publicación",
                  // mientras que la foto de la MISMA card sí nombraba al autor.
                  authorName={authorName}
                  viewCount={viewCount}
                  active={active}
                  onTap={onVideoTap ? () => onVideoTap(slideIndex) : undefined}
                  music={music}
                  // Filtro de ESTA diapositiva (0104), ya resuelto a CSS por el
                  // servidor. Viaja dentro del medio y no como prop del carrusel
                  // porque es una decisión POR ARCHIVO: un post puede traer un
                  // video con Vintage y otro sin nada.
                  filterCss={item.filterCss}
                  // Sólo los traen los videos de Mux; ausentes, `CardVideo`
                  // reproduce el archivo de `src` como toda la vida.
                  muxPlaybackId={item.muxPlaybackId}
                  muxStatus={item.muxStatus}
                />
              ) : (
                <>
                  {/* La foto ES el contenido acá (no una miniatura de listado
                      con título al lado): el default decorativo de CardMedia
                      (alt="") la dejaría invisible para un lector de pantalla.
                      Sin cuerpo de post disponible en estas props, se usa el
                      genérico de CAROUSEL_COPY — "Foto de la publicación" o,
                      en carrusel, "Foto 2 de 3" (misma cuenta que ya lee el
                      aria-label de la diapositiva). */}
                  <CardMedia
                    src={item.url}
                    fallbackSrc={item.url}
                    alt={CAROUSEL_COPY.photoAlt(slideIndex + 1, total)}
                    aspect="portrait"
                    quality={62}
                  />
                  {/* Capa de toque sobre la foto: simple = visor, doble = me gusta.
                      Es un botón real (Enter abre el visor); el doble-tap es un
                      extra táctil, nunca el único camino al me gusta. Sólo la
                      diapositiva visible entra en la tabulación. */}
                  <button
                    type="button"
                    onClick={() => handlePhotoTap(slideIndex)}
                    tabIndex={active ? 0 : -1}
                    aria-label={COPY.post.openPhoto}
                    className="absolute inset-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring"
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      {isCarousel && (
        <>
          {/* Qué medio se está viendo, para quien no ve los puntitos. */}
          <span className="sr-only" aria-live="polite">
            {slideLabel(items[index] ?? items[0], index)}
          </span>

          {/* Puntitos: indicador de estado, no control (ver cabecera del módulo).

              `cl-print-fill` va en el CONTENEDOR de las dos formas del indicador
              porque `print-color-adjust` se HEREDA (globals.css lo documenta):
              con un solo hook se salvan las dos. Sin él, en papel el indicador
              desaparece — el navegador no imprime `background-color`, así que se
              va el velo y con él los puntitos (`bg-on-media` puro) y el relleno
              del contador, que encima escribe `text-on-media`: tinta clara sobre
              papel blanco, 1.00:1. Mismo patrón que la píldora de vistas de
              card-video.tsx. */}
          <div
            aria-hidden="true"
            className={cn(
              "cl-print-fill pointer-events-none absolute bottom-3 left-1/2 z-[2] -translate-x-1/2",
              dotsClassName,
            )}
          >
            {total <= MAX_DOTS ? (
              <div
                data-carousel-dots=""
                // Chip de vidrio plano (sin backdrop-blur a propósito: desenfocar
                // un fondo que se mueve durante el swipe repinta en cada frame).
                // El aro interior lo despega de la foto sin ensuciarla.
                className="flex items-center gap-1.5 rounded-full bg-media-shade/45 px-2 py-[5px] ring-1 ring-inset ring-on-media/20"
              >
                {items.map((item, dotIndex) => (
                  <span
                    key={`${item.url}-dot-${dotIndex}`}
                    className={cn(
                      "size-1.5 rounded-full",
                      // Sólo transform y color: nada que dispare layout.
                      "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
                      dotIndex === index
                        ? "scale-[1.35] bg-on-media"
                        : "bg-on-media/40",
                    )}
                  />
                ))}
              </div>
            ) : (
              <span
                data-carousel-dots=""
                className="numeric rounded-full bg-media-scrim px-2 py-0.5 text-xs font-semibold text-on-media"
              >
                {CAROUSEL_COPY.counter(index + 1, total)}
              </span>
            )}
          </div>

          {/* Flechas: sólo donde hay mouse fino (en táctil manda el dedo). Se
              revelan al pasar por encima o al recibir foco; en el extremo quedan
              atenuadas pero NUNCA desaparecen ni se deshabilitan, así el foco
              del teclado no se pierde al llegar al último medio. */}
          <CarouselArrow
            direction="prev"
            atEdge={index === 0}
            onClick={() => scrollToIndex(index - 1)}
          />
          <CarouselArrow
            direction="next"
            atEdge={index === total - 1}
            onClick={() => scrollToIndex(index + 1)}
          />
        </>
      )}
    </div>
  );
}

function CarouselArrow({
  direction,
  atEdge,
  onClick,
}: {
  direction: "prev" | "next";
  atEdge: boolean;
  onClick: () => void;
}) {
  const isPrev = direction === "prev";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isPrev ? CAROUSEL_COPY.prev : CAROUSEL_COPY.next}
      aria-disabled={atEdge}
      className={cn(
        "absolute top-1/2 z-[2] hidden size-11 -translate-y-1/2 place-items-center rounded-full",
        // Sólo donde hay mouse fino: en táctil manda el dedo y unas flechas
        // encima de la foto se comerían el área del doble toque.
        "pointer-fine:grid",
        isPrev ? "left-1.5" : "right-1.5",
        // Aparecen al acercarse a la card o al tabular hasta ellas. `focus:` va
        // ADEMÁS de `focus-visible:` a propósito: un botón invisible que recibe
        // el foco es una trampa, y `:focus-visible` no matchea cuando el foco
        // llega por programa (p. ej. tras cerrar el visor y devolverlo acá).
        "opacity-0 transition-opacity duration-(--duration-fast)",
        "group-hover/carousel:opacity-100 focus:opacity-100 focus-visible:opacity-100",
        atEdge && "group-hover/carousel:opacity-40",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60",
      )}
    >
      <span className="grid size-8 place-items-center rounded-full bg-media-scrim text-on-media transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-90">
        {isPrev ? (
          <CaretLeft size={16} weight="bold" aria-hidden="true" />
        ) : (
          <CaretRight size={16} weight="bold" aria-hidden="true" />
        )}
      </span>
    </button>
  );
}
