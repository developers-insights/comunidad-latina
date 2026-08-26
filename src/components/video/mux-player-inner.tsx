"use client";

import MuxPlayerReact from "@mux/mux-player-react";
import { useEffect, type MutableRefObject } from "react";
import type { PlayableMedia } from "./playable-media";

/**
 * EL ÚNICO ARCHIVO DE TODO EL REPO QUE IMPORTA `@mux/mux-player-react`.
 *
 * Y es a propósito que sea uno solo: el paquete pesa (trae `media-chrome`,
 * `hls.js` y el núcleo de reproducción de Mux). Quien entra al feed y no se
 * cruza con ningún video de Mux no tiene por qué descargar nada de eso, y la
 * forma de garantizarlo es que exista un único punto de entrada al que se llegue
 * SIEMPRE por `next/dynamic` — ver `mux-player.tsx`, que es el que lo carga.
 *
 * Si alguien vuelve a importar `@mux/mux-player-react` desde otro archivo, el
 * bundler lo mete en el chunk de ese archivo y el ahorro desaparece sin que
 * ningún test se ponga rojo. Por eso está escrito acá arriba.
 *
 * ── POR QUÉ `mediaRef` ES UNA PROP Y NO UN `ref` ────────────────────────────
 * Este componente se monta a través de `next/dynamic`, y un `ref` sobre un
 * componente cargado en diferido depende de que la cadena de reenvío quede
 * intacta a través de la envoltura. Una prop común atraviesa esa envoltura sin
 * ninguna ambigüedad. Es la misma referencia, por un camino que no se puede
 * romper en un refactor.
 */

export interface MuxPlayerInnerProps {
  playbackId: string;
  /** Ref de la tarjeta: el MISMO objeto que usaría con un `<video>`. */
  mediaRef?: MutableRefObject<PlayableMedia | null>;
  className?: string;
  style?: React.CSSProperties;
  muted?: boolean;
  loop?: boolean;
  autoPlay?: boolean;
  /** Nombre accesible. El reproductor no tiene controles: es un medio, no un widget. */
  ariaLabel?: string;
  /**
   * `cover` recorta para llenar la caja (la tarjeta del feed, el reel vertical);
   * `contain` muestra el cuadro entero con bandas (un video horizontal abierto a
   * pantalla completa). Es la MISMA decisión que toma el `object-fit` del
   * `<video>`, sólo que acá viaja por una variable CSS porque el elemento real
   * vive dentro del shadow DOM del reproductor.
   */
  objectFit?: "cover" | "contain";
  /**
   * EL AVISO QUE EVITA UN VIDEO QUE NUNCA ARRANCA. Este componente se monta en
   * diferido, así que `mediaRef.current` está en `null` durante el primer render
   * de quien lo usa — y los efectos que deciden reproducir ya corrieron para
   * entonces. Sin este aviso, una tarjeta que ya estaba a la vista cuando el
   * reproductor terminó de cargar se quedaría en su miniatura para siempre: el
   * observador de visibilidad no vuelve a dispararse porque nada cambió de
   * visibilidad.
   */
  onReady?: () => void;
  onLoadedMetadata?: (durationSeconds: number) => void;
  onTimeUpdate?: (currentSeconds: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  /** Mux no pudo entregar el HLS: la tarjeta cae al estado de fallo. */
  onError?: () => void;
}

export default function MuxPlayerInner({
  playbackId,
  mediaRef,
  className,
  style,
  muted = true,
  loop = true,
  autoPlay = false,
  ariaLabel,
  objectFit = "cover",
  onReady,
  onLoadedMetadata,
  onTimeUpdate,
  onPlay,
  onPause,
  onError,
}: MuxPlayerInnerProps) {
  // Después del primer render el `ref` ya está puesto: recién ahí hay un
  // elemento con el que reproducir, y recién ahí tiene sentido avisar.
  useEffect(() => {
    onReady?.();
    // Una sola vez por montaje: el elemento no cambia mientras viva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MuxPlayerReact
      playbackId={playbackId}
      streamType="on-demand"
      ref={(element) => {
        if (mediaRef) mediaRef.current = element as PlayableMedia | null;
      }}
      muted={muted}
      loop={loop}
      autoPlay={autoPlay}
      playsInline
      /**
       * CONTROLES APAGADOS. La tarjeta del feed ya tiene su propia gramática
       * —un toque abre el visor, dos toques dan me gusta, el altavoz vive abajo
       * a la derecha— y la barra de Mux encima competiría con los tres gestos a
       * la vez: el play/pausa se comería el toque simple, la barra de tiempo se
       * comería el deslizamiento del carrusel, y su botón de sonido sería un
       * segundo control de lo mismo, en otro lugar y con otro aspecto.
       *
       * `--controls: none` es la variable de la propia hoja de estilos del
       * reproductor (apaga las tres barras: superior, central e inferior). Se
       * escribe como estilo en línea porque atraviesa el shadow DOM del custom
       * element, que es donde viven esos controles — una clase de Tailwind no
       * llega ahí adentro.
       *
       * `--media-object-fit: cover` espeja el `object-cover` que ya tiene el
       * `<video>` de la tarjeta, y `--media-object-position: center` lo centra:
       * un video vertical y uno horizontal tienen que llenar la misma caja 4:5
       * exactamente igual que antes.
       */
      style={{
        // Variables CSS del propio reproductor: es la vía oficial de Mux para
        // configurarlo desde AFUERA de su shadow DOM, que es donde viven los
        // controles y el `<video>` real. Una clase de Tailwind no llega ahí.
        "--controls": "none",
        "--media-object-fit": objectFit,
        "--media-object-position": "center",
        // Sin esto el custom element arranca con su alto intrínseco y la tarjeta
        // salta cuando el reproductor termina de definirse (CLS).
        width: "100%",
        height: "100%",
        display: "block",
        ...style,
      }}
      className={className}
      aria-label={ariaLabel}
      onLoadedMetadata={(event) => {
        const value = (event.currentTarget as unknown as { duration?: number }).duration;
        if (typeof value === "number" && Number.isFinite(value)) onLoadedMetadata?.(value);
      }}
      onTimeUpdate={(event) => {
        const value = (event.currentTarget as unknown as { currentTime?: number }).currentTime;
        if (typeof value === "number") onTimeUpdate?.(value);
      }}
      onPlay={() => onPlay?.()}
      onPause={() => onPause?.()}
      onError={() => onError?.()}
      /**
       * La insignia de Mux queda apagada: esto es la comunidad de alguien, no una
       * demo de un proveedor. (Es el default de la librería; se escribe explícito
       * para que un cambio de default no meta un logo ajeno en el feed.)
       */
      proudlyDisplayMuxBadge={false}
    />
  );
}
