"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { muxThumbnailUrl } from "@/lib/media/mux-video";
import { cn } from "@/lib/utils";
import { VIDEO_COPY } from "./copy";
import type { PlayableMedia } from "./playable-media";

/**
 * =============================================================================
 * EL REPRODUCTOR DE MUX, QUE NO LE CUESTA NADA A QUIEN NO LO USA
 * =============================================================================
 *
 * `@mux/mux-player-react` no es liviano: arrastra `media-chrome`, `hls.js` y el
 * núcleo de reproducción. Meterlo en el bundle del feed sería cobrarle ese peso
 * a TODA la comunidad —incluida la mayoría que abre el feed, ve fotos y se va—
 * para que lo aproveche la minoría que se cruza con un video de Mux.
 *
 * Tres capas hacen que eso no pase:
 *
 *  1. UN SOLO PUNTO DE ENTRADA. `mux-player-inner.tsx` es el único archivo que
 *     importa la librería, y sólo se llega a él por `next/dynamic`. Webpack le
 *     arma su propio chunk, que no está en el grafo inicial de ninguna ruta.
 *  2. `ssr: false`. No tiene sentido prerenderizar en el servidor un custom
 *     element que necesita el DOM para existir; además, así el HTML del feed no
 *     crece ni un byte por esto.
 *  3. SE MONTA CUANDO LA TARJETA SE ESTÁ ACERCANDO, no al renderizar. Un feed
 *     con veinte publicaciones no descarga veinte reproductores: descarga el
 *     chunk una vez y monta el reproductor de la tarjeta que viene entrando.
 *
 * ── Y MIENTRAS TANTO, ¿QUÉ SE VE? ───────────────────────────────────────────
 * La MINIATURA del video, siempre pintada debajo. Es lo que evita que el ahorro
 * de bundle se pague con un rectángulo gris: el `<video preload="metadata">` de
 * siempre mostraba el primer cuadro, y esta tarjeta también. El reproductor
 * aparece encima cuando está listo, sin salto de layout — los dos ocupan
 * exactamente la misma caja.
 */

const MuxPlayerInner = dynamic(() => import("./mux-player-inner"), {
  ssr: false,
  // Sin placeholder propio: la miniatura de abajo YA está en su lugar y ocupando
  // la caja. Un segundo indicador acá sólo agregaría un parpadeo.
  loading: () => null,
});

/**
 * Cuánto antes de entrar en pantalla se empieza a montar el reproductor. 300 px
 * es aproximadamente media tarjeta de feed: alcanza para que el chunk baje y el
 * elemento se defina antes de que la persona llegue a mirarlo, y no tanto como
 * para montar reproductores de publicaciones que nunca va a ver.
 */
const MARGEN_DE_PRECARGA = "300px";

export interface MuxVideoSurfaceProps {
  playbackId: string;
  /**
   * Ref de la tarjeta. Es el MISMO objeto que ya usaba con el `<video>`: el
   * reproductor de Mux cumple el contrato mínimo de `PlayableMedia`, así que la
   * tarjeta no cambia una línea de su lógica de reproducción.
   */
  mediaRef?: MutableRefObject<PlayableMedia | null>;
  className?: string;
  /** Filtro de presentación (0104), ya resuelto a CSS por el servidor. */
  filterCss?: string;
  muted?: boolean;
  loop?: boolean;
  autoPlay?: boolean;
  ariaLabel?: string;
  /**
   * `card` = la caja 4:5 de la tarjeta del feed, que es quien define su propia
   * altura. `fill` = ocupar el alto del contenedor, que es lo que necesita el
   * visor a pantalla completa y el reel (ahí la caja la define la pantalla).
   */
  layout?: "card" | "fill";
  objectFit?: "cover" | "contain";
  /** El reproductor ya existe y `mediaRef` apunta a él. Ver `MuxPlayerInner`. */
  onReady?: () => void;
  onLoadedMetadata?: (durationSeconds: number) => void;
  onTimeUpdate?: (currentSeconds: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onError?: () => void;
}

export function MuxVideoSurface({
  playbackId,
  mediaRef,
  className,
  filterCss,
  muted = true,
  loop = true,
  autoPlay = false,
  ariaLabel,
  layout = "card",
  objectFit = "cover",
  onReady,
  onLoadedMetadata,
  onTimeUpdate,
  onPlay,
  onPause,
  onError,
}: MuxVideoSurfaceProps) {
  const cajaRef = useRef<HTMLDivElement | null>(null);
  const [montar, setMontar] = useState(false);

  useEffect(() => {
    if (montar) return;
    const nodo = cajaRef.current;
    // Sin IntersectionObserver (jsdom, navegadores muy viejos) se monta ya: es
    // mejor gastar el chunk que dejar una miniatura que nunca reproduce.
    if (!nodo || typeof IntersectionObserver === "undefined") {
      setMontar(true);
      return;
    }
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((entrada) => entrada.isIntersecting)) setMontar(true);
      },
      { rootMargin: MARGEN_DE_PRECARGA },
    );
    observador.observe(nodo);
    return () => observador.disconnect();
  }, [montar]);

  return (
    <div
      ref={cajaRef}
      className={cn(
        "relative overflow-hidden",
        layout === "fill" ? "h-full w-full" : "aspect-[4/5] w-full bg-surface-subtle",
        className,
      )}
      // Igual que en la tarjeta con `<video>`: el filtro va sobre el MEDIO, no
      // sobre la interfaz que se pinta encima (ver `card-video.tsx`). Cadena
      // vacía → sin atributo, para no crear una capa de composición por nada.
      style={filterCss ? { filter: filterCss } : undefined}
    >
      {/*
        LA MINIATURA. `<img>` pelado y no `next/image` a propósito: `image.mux.com`
        ya devuelve WebP dimensionado por el propio servicio, así que pasarlo por
        el optimizador sería un segundo salto de red para rehacer un trabajo que
        ya está hecho — y obligaría a declarar el dominio en `next.config.ts`.
        `aria-hidden`: lo que hay acá lo nombra el reproductor de encima; para un
        lector de pantalla esto es la misma cosa vista dos veces.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- miniatura servida y dimensionada por image.mux.com */}
      <img
        src={muxThumbnailUrl(playbackId)}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        draggable={false}
        className={cn(
          "absolute inset-0 size-full",
          objectFit === "contain" ? "object-contain" : "object-cover",
        )}
      />

      {montar && (
        <div className="absolute inset-0">
          <MuxPlayerInner
            playbackId={playbackId}
            mediaRef={mediaRef}
            muted={muted}
            loop={loop}
            autoPlay={autoPlay}
            ariaLabel={ariaLabel ?? VIDEO_COPY.reproductorLabel}
            objectFit={objectFit}
            onReady={onReady}
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onPlay={onPlay}
            onPause={onPause}
            onError={onError}
          />
        </div>
      )}
    </div>
  );
}
