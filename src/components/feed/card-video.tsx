"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence } from "motion/react";
import { useRouter } from "next/navigation";
import { Eye, Heart } from "@phosphor-icons/react/dist/ssr";
import { usePrefersReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";
import { isPreviewTruncated, playbackCapSeconds } from "@/lib/media/video-policy";
import { usePostMusic } from "./post-music";
import { VIDEOS_COPY } from "@/app/(app)/videos/copy";
import { muxPlaybackMode } from "@/lib/media/mux-video";
import { MuxVideoSurface } from "@/components/video/mux-player";
import { VideoStatusCard } from "@/components/video/video-status-card";
import { useMuxLiveStatus } from "@/components/video/mux-status-poll";
import { safePlayMedia, type PlayableMedia } from "@/components/video/playable-media";
import { useCardLike } from "./card-like-context";
import { useCardMedia } from "./card-media-context";
import { useMediaViewer, type ViewerMediaItem } from "./media-viewer";
import { COPY } from "./copy";
import type { VideoScopeProp } from "./helpers";
import styles from "./card-post-media.module.css";

/**
 * EL REEL, EN DIFERIDO Y A PROPÓSITO (2026-09-03).
 *
 * Dos razones, las dos concretas:
 *
 *  1. PESO. El reel arrastra su scroll infinito, el riel de acciones, el me
 *     gusta optimista y la hoja de comentarios. Un feed con veinte tarjetas no
 *     puede pagar ese chunk en el primer render para algo que se abre sólo si
 *     alguien toca un video — es exactamente el tipo de JavaScript que hunde el
 *     LCP de la pantalla más visitada de la app.
 *  2. EL CICLO. `videos/video-reels.tsx` importa de `@/components/feed`, que
 *     re-exporta este archivo. Un import estático de vuelta cerraría el círculo;
 *     el `import()` diferido lo corta, porque se evalúa cuando el barril ya
 *     terminó de cargarse.
 *
 * `ssr: false`: el overlay sólo existe después de un toque, así que no hay nada
 * que renderizar en el servidor.
 */
const ReelOverlay = dynamic(
  () => import("@/app/(app)/videos/reel-overlay").then((mod) => mod.ReelOverlay),
  { ssr: false },
);

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
 * directamente `undefined` (navegadores viejos, jsdom): encadenar `.catch()` a
 * ciegas tiraba un TypeError.
 *
 * Vivía acá como función local sobre `HTMLMediaElement`. Se mudó a
 * `@/components/video/playable-media` cuando el elemento de medio dejó de ser
 * siempre un `<video>`: con Mux es un custom element que NO es un
 * `HTMLMediaElement`, pero implementa los mismos cuatro métodos. El helper
 * compartido habla de esa capacidad y no de una clase del DOM — así el
 * `<video>` del bucket, el `<audio>` de la música (0061) y el reproductor de
 * Mux pasan los tres por la misma función.
 */
const safePlay = safePlayMedia;

export interface CardVideoProps {
  src: string;
  /**
   * Post de origen. Viaja al visor para que la vista quede contada sobre la
   * publicación correcta, y arma la URL del reel en el único caso en que
   * todavía se navega (ver `openVideo`).
   */
  postId: string;
  /**
   * Contexto del feed de videos (p. ej. "para-ti" en el feed general). Tipado
   * como el resto de la cadena: un scope inventado no puede llegar hasta la URL
   * del reel sin que el compilador lo frene (ver `VideoScopeProp`).
   */
  scope: VideoScopeProp;
  /**
   * Nombre visible del autor. Sólo viaja al visor, para que su encabezado diga
   * de quién es el video y su `aria-label` no caiga en el genérico "Fotos y
   * videos de la publicación" — que es lo que se leía cuando este camino no
   * conocía al autor. La tarjeta no lo pinta: eso ya lo hace su cabecera.
   */
  authorName?: string;
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
   * Qué hace el toque simple, cuando quien monta el video quiere decidirlo:
   * el detalle de una publicación y los anuncios abren el visor CON las
   * diapositivas y el tope que ellos calculan (ver CardPostMedia).
   *
   * Sin esto el toque también abre el visor —el default dejó de navegar el
   * 2026-08-20—, sólo que armado con lo que la propia tarjeta sabe.
   */
  onTap?: () => void;
  className?: string;
  /**
   * FILTRO DE PRESENTACIÓN (0104), ya resuelto a un valor de `filter` de CSS por
   * el servidor a partir del catálogo (`resolvePhotoFilterCss`). Vacío o ausente
   * = el video se ve tal cual se subió.
   *
   * Se aplica al PINTAR y no está quemado en el archivo, a diferencia de la
   * foto: hornear un video es re-codificarlo en tiempo real, rompe la subida
   * directa al bucket y le cambia la huella perceptual a Content Integrity (ver
   * la 0104). El archivo sigue siendo el original; lo que cambia es cómo se ve.
   *
   * Va sobre el `<video>` y no sobre su contenedor a propósito: el chip de
   * vistas, el botón de sonido y el corazón del doble toque son de la INTERFAZ,
   * no del video, y un filtro que también los tiña dejaría "Vista previa"
   * ilegible sobre un Carbón al 100%.
   */
  filterCss?: string;
  /**
   * ---- EL VIDEO POR MUX (opcional, y ausente es el caso normal) -----------
   *
   * `posts.mux_playback_id` y `posts.mux_status`. Los dos ausentes —que es lo
   * que traen los 36 videos que ya estaban en el bucket, y todo lo que se suba
   * mientras Mux esté apagado— significan "reproducí el archivo de `src` con el
   * `<video>` de siempre". Ese es el camino por defecto y no cambió en nada.
   *
   * Con ellos presentes, `muxPlaybackMode` decide cuál de los cuatro estados se
   * pinta (ver `@/lib/media/mux-video`). Lo que NO cambia en ninguno de los
   * casos es todo lo demás de esta tarjeta: el autoplay al 60 %, el tope de 59 s
   * de la vista previa, el toque, el doble toque, el altavoz y la música siguen
   * siendo exactamente los mismos, porque operan sobre el contrato mínimo de
   * `PlayableMedia` y no sobre un `<video>` en particular.
   */
  muxPlaybackId?: string | null;
  muxStatus?: unknown;
  /**
   * PRIMER CUADRO DEL VIDEO, capturado al subir (0132). Lo que el `<video>`
   * pinta mientras el archivo del bucket todavía no llegó.
   *
   * Sin esto, un `.mp4` crudo no tiene NADA que mostrar hasta que baja su
   * metadata: es el rectángulo en blanco que el cliente reportó al scrollear
   * (2026-09-03, 1:07:00). Ausente —los videos anteriores a la 0132, o un
   * archivo que el navegador no pudo decodificar al subir— el elemento se
   * comporta como siempre sobre el fondo `surface-subtle` de su caja, que ya es
   * un color de la marca y no un hueco blanco.
   */
  posterUrl?: string | null;
}

/** Segundos que la TARJETA reproduce. El completo se abre desde la publicación. */
const PREVIEW_CAP_SECONDS = playbackCapSeconds("feed");

/**
 * Tope del VISOR cuando el video se abre desde la tarjeta: el de una
 * publicación (300 s), no el de la vista previa. Lo que el toque abre ES el
 * video completo — que era, textual, la promesa de su etiqueta ("Ver el video
 * completo").
 *
 * El tope de 10 minutos del anuncio no se decide acá y no hace falta que se
 * decida: un anuncio nunca llega a este camino, porque CardPostMedia le pasa su
 * propio `onTap` con el tope que calculó (ver `viewerPlaybackCapFor`).
 */
const VIEWER_CAP_SECONDS = playbackCapSeconds("detail");

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
 *  - un toque abre el visor a pantalla completa SOBRE el feed, sin navegar;
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
  authorName,
  viewCount = 0,
  active = true,
  onTap,
  className,
  filterCss,
  muxPlaybackId = null,
  muxStatus,
  posterUrl = null,
}: CardVideoProps) {
  const router = useRouter();
  const reduce = usePrefersReducedMotion();
  const like = useCardLike();
  const viewer = useMediaViewer();
  const media = useCardMedia();
  /**
   * DOS REFS DONDE ANTES HABÍA UNA, y no es un capricho:
   *
   *  · `videoRef` es el elemento con el que se REPRODUCE. Dejó de ser un
   *    `HTMLVideoElement` porque con Mux es un custom element; lo que se le pide
   *    (play, pause, currentTime, muted, duration) es lo mismo en los dos casos,
   *    y eso es lo que declara `PlayableMedia`.
   *  · `boxRef` es la caja que se OBSERVA para el autoplay. Antes se observaba
   *    el `<video>` directamente, pero un `IntersectionObserver` necesita un
   *    Element del DOM y `PlayableMedia` no promete serlo. La caja envuelve al
   *    medio y a sus capas, así que ocupa exactamente el mismo rectángulo: el
   *    umbral del 60 % sigue significando lo mismo que antes.
   */
  const videoRef = useRef<PlayableMedia | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const delayRef = useRef<number | null>(null);
  const tapTimer = useRef<number | null>(null);
  const [bursts, setBursts] = useState(0);
  /**
   * ¿ESTÁ ABIERTO EL REEL SOBRE ESTA TARJETA? (2026-09-03)
   *
   * El estado vive acá, en la tarjeta que recibió el toque, y no en un provider
   * de la app. No es por comodidad: el reel necesita el contexto de la hoja de
   * comentarios y de la firma activa, y los dos providers están MÁS ADENTRO que
   * `MediaViewerProvider` en el layout. Un overlay montado desde allá arriba se
   * quedaría sin ellos (el contexto sigue el árbol de React, no el portal).
   * Montándolo desde la tarjeta, el reel ve exactamente lo mismo que ve el feed.
   *
   * Que sea por tarjeta no permite dos reels abiertos: sólo un toque puede estar
   * en curso, y mientras el overlay está abierto el scroll del cuerpo está
   * bloqueado, así que la tarjeta no puede desmontarse por debajo.
   */
  const [reelAbierto, setReelAbierto] = useState(false);
  /** Duración MEDIDA del archivo (metadata), no la declarada. null = todavía no. */
  const [measuredSeconds, setMeasuredSeconds] = useState<number | null>(null);
  const isPreview = isPreviewTruncated(measuredSeconds);

  /**
   * ---- QUIÉN DECIDE SI ESTE VIDEO SUENA ----------------------------------
   *
   * No este componente. La publicación tiene UNA pista y UN altavoz
   * (`PostMusicProvider`, en post-music.tsx): acá sólo se lee el veredicto ya
   * resuelto de `resolveAudioMix` y se aplica al elemento.
   *
   * Hasta el 2026-08-26 el `<audio>` de la música, el gesto de sonido y el
   * altavoz vivían ACÁ ADENTRO, y ése era el bug: una publicación de fotos con
   * música no montaba ninguno de los tres, porque no tenía video donde
   * montarlos.
   *
   * Fuera de una publicación (sin provider) el video queda MUDO, que es el
   * estado por defecto de siempre: nadie reproduce con sonido sin un gesto, y
   * el gesto es de la publicación.
   */
  const postMusic = usePostMusic();
  const videoMuted = postMusic?.mix.videoMuted ?? true;

  /**
   * ---- ¿QUÉ SE PINTA EN LA CAJA DEL VIDEO? -------------------------------
   *
   * `useMuxLiveStatus` arranca con lo que trajo el servidor y, sólo si ese
   * estado todavía puede cambiar solo (subiendo / procesando), se engancha al
   * sondeo compartido hasta que cambie. Para un video que ya llegó listo —y
   * para los 36 del bucket, que no tienen estado de Mux— esto no hace ni una
   * consulta ni monta un temporizador.
   *
   * `reproductorFallado` es la otra fuente de "no se puede ver": el propio
   * reproductor avisando que no pudo con el HLS. Se trata igual que un
   * `errored` de la base porque para quien mira es lo mismo, y es mejor decirlo
   * que dejar un rectángulo negro con un error adentro.
   */
  const [reproductorFallado, setReproductorFallado] = useState(false);
  /**
   * El reproductor de Mux ya está montado y `videoRef` apunta a él. Entra en las
   * dependencias del observador de visibilidad de más abajo, y ESO es lo que
   * evita un video que nunca arranca: cuando el reproductor termina de cargar
   * (unos cientos de milisegundos después del primer render, porque el chunk
   * baja aparte), el observador se vuelve a armar y evalúa la visibilidad ACTUAL
   * — que es la que importa. Sin esto, una tarjeta que ya estaba a la vista se
   * quedaría en su miniatura para siempre: el observador no se dispara de nuevo
   * porque nada cambió de visibilidad, sólo cambió quién estaba escuchando.
   */
  const [muxMontado, setMuxMontado] = useState(false);
  const muxVivo = useMuxLiveStatus({ postId, status: muxStatus, playbackId: muxPlaybackId });
  const modo = reproductorFallado
    ? "errored"
    : muxPlaybackMode({ playbackId: muxVivo.playbackId, status: muxVivo.status });

  // Dejar de ser el medio activo (el usuario pasó a la foto siguiente del
  // carrusel) pausa YA, sin esperar a que el observer note que salió de vista.
  // La MÚSICA no se toca acá: es de la publicación, no de esta diapositiva —
  // pasar de un video a la foto de al lado no puede cortar la canción.
  useEffect(() => {
    if (active) return;
    videoRef.current?.pause();
  }, [active]);

  // El `<video muted>` es un atributo DOM que no se controla vía JSX (se pisa
  // a mano, igual que antes): acá se refleja lo que decide el árbitro cada vez
  // que el gesto de sonido cambia. Al desmutear también se retoma la
  // reproducción — mismo comportamiento que el toggle de siempre.
  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    node.muted = videoMuted;
    if (!videoMuted) safePlay(node);
  }, [videoMuted]);

  useEffect(() => {
    // Reduced-motion: no autoplay. El video (y la música) quedan pausados.
    if (reduce) return;
    // Fuera de la diapositiva visible no se arranca nada: dos videos del mismo
    // post no pueden sonar juntos.
    if (!active) return;
    // Se observa la CAJA, no el medio: ver el comentario de `boxRef` arriba.
    // Quien arranca y pausa sigue siendo el medio, que se lee de la ref en el
    // momento de usarlo — con Mux el reproductor se monta un instante después
    // que la caja, y leerlo acá arriba lo dejaría en null para siempre.
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === "undefined") return;

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
                // La MÚSICA tiene su propio observador, sobre la caja de la
                // publicación (post-music.tsx): sigue a la publicación entera y
                // no a este medio.
                safePlay(videoRef.current);
              }, AUTOPLAY_DELAY_MS);
            }
          } else {
            clearDelay();
            videoRef.current?.pause();
          }
        }
      },
      { threshold: [VISIBLE_RATIO] },
    );
    io.observe(box);
    return () => {
      clearDelay();
      io.disconnect();
    };
  }, [reduce, active, muxMontado]);

  // Si la card se desmonta con un toque en vuelo (scroll rápido), no dejar que
  // el timer abra el visor desde una card que ya no está en pantalla.
  useEffect(
    () => () => {
      if (tapTimer.current !== null) clearTimeout(tapTimer.current);
    },
    [],
  );

  /**
   * LAS DIAPOSITIVAS QUE VE EL VISOR. Cuando la tarjeta declaró sus medios —el
   * carrusel los publica en el contexto— se abren TODAS, arrancando en este
   * video: tocar el video de un post que además trae fotos tiene que dejar
   * llegar a las fotos, igual que tocar una foto ya deja llegar al video.
   * Fuera de una tarjeta con contexto (un video suelto) se abre este archivo y
   * nada más.
   */
  function viewerSlides(): { items: ViewerMediaItem[]; startIndex: number } {
    const all = media?.items ?? [];
    const found = all.findIndex((item) => item.kind === "video" && item.url === src);
    // Sin contexto de carrusel (un video suelto) el visor abre este medio y
    // nada más — y tiene que llevarse el playbackId, o el visor caería a un
    // `<video src>` apuntando a la miniatura del video de Mux.
    //
    // La clave sólo viaja cuando HAY playbackId: para un video del bucket la
    // diapositiva tiene que ser exactamente la de siempre, sin un campo de más
    // que diga `null`. No es cosmético — es lo que mantiene idéntico el objeto
    // que recibe el visor por el camino que no cambió.
    if (found < 0) {
      return {
        items: [
          muxVivo.playbackId
            ? { kind: "video" as const, url: src, muxPlaybackId: muxVivo.playbackId }
            : { kind: "video" as const, url: src },
        ],
        startIndex: 0,
      };
    }
    return { items: all, startIndex: found };
  }

  /**
   * Al cerrarse el visor la tarjeta retoma sola. Sin esto quedaba congelada en
   * el frame donde la pausamos: el observador de visibilidad no vuelve a
   * dispararse porque la card nunca dejó de estar a la vista (el visor es un
   * overlay, no una navegación). Con reduced-motion no se retoma nada — ahí el
   * video nunca arranca solo.
   */
  function resumeAfterViewer() {
    if (reduce) return;
    const node = videoRef.current;
    if (node) safePlay(node);
    // Y la música de la publicación, que se calló al abrir (ver `openVideo`).
    postMusic?.resume();
  }

  /**
   * EL TOQUE ABRE EL VIDEO SIN MOVERTE DEL FEED (pedido del cliente,
   * 2026-08-20: "no te tiene que mover a otra publicación; ahí nomás dentro de
   * pantalla se tiene que fluir sin sacarte del feed; si no es como que te
   * corta el mambo. Mientras menos pasos mejor"). Hasta ese día esto navegaba a
   * `/videos`, y volver costaba un "atrás" que además perdía el scroll del feed
   * y te dejaba parado en OTRA publicación.
   *
   * `/videos` no se toca: sigue siendo el destino de Videos Cortos, donde el
   * scroll vertical entre publicaciones ES lo que la persona fue a buscar. Lo
   * que cambió es el gesto de la tarjeta, que nunca lo pidió.
   */
  /**
   * EL VISOR DE LA PROPIA PUBLICACIÓN — el camino de siempre, hoy usado como
   * RESPALDO del reel: si el reel no tiene nada que mostrar para este post (dejó
   * de ser elegible entre que se pintó el feed y el dedo tocó), esto es lo que
   * queda, y sigue siendo mejor que nada — el video se ve completo, encima del
   * feed, y al cerrar volvés al mismo lugar.
   */
  function openViewer() {
    // Sin provider de visor montado el toque quedaría muerto: ahí sí, navegar.
    if (!viewer.available) {
      router.push(
        `/videos?start=${encodeURIComponent(postId)}&scope=${encodeURIComponent(scope)}`,
      );
      return;
    }
    const node = videoRef.current;
    const { items, startIndex } = viewerSlides();
    // La tarjeta se calla ANTES de abrir: el visor arranca con sonido y dos
    // copias del mismo clip sonando juntas no se le hace a nadie.
    node?.pause();
    postMusic?.pause();
    viewer.open({
      items,
      startIndex,
      postId,
      authorName,
      maxPlaybackSeconds: VIEWER_CAP_SECONDS,
      startSeconds: node?.currentTime,
      onClose: resumeAfterViewer,
    });
  }

  /**
   * EL TOQUE ABRE EL REEL, ENCIMA DEL FEED (cliente 2026-09-03, 17:23–18:20:
   * «ahí no te sale la música… debería hacer scrolling los videos»).
   *
   * ---- LA HISTORIA, PORQUE ESTO YA CAMBIÓ DOS VECES ----------------------
   *
   *  · Hasta el 2026-08-20 el toque NAVEGABA a `/videos?start=`. Eso era el reel
   *    con música y scroll, sí, pero volver costaba un "atrás" que perdía el
   *    scroll del feed y dejaba a la persona parada en otra publicación. El
   *    cliente pidió sacarlo: «no te tiene que mover a otra publicación».
   *  · Desde entonces abría el visor de la propia publicación, acá nomás. Eso
   *    resolvió lo del scroll del feed y creó lo otro: el visor no monta la
   *    música (vive en la tarjeta) y no lleva a ningún otro video.
   *
   * Los dos pedidos no se contradicen —uno es sobre PERDER EL LUGAR y el otro
   * sobre PODER SEGUIR VIENDO— y esto cumple los dos: el reel completo, montado
   * ENCIMA del feed. No hay navegación, así que al cerrar el feed sigue donde
   * estaba y esta tarjeta retoma con `resumeAfterViewer`.
   *
   * FOTOS, TEXTO Y ENCUESTAS NO CAMBIAN: siguen resolviéndose en la tarjeta con
   * el visor de siempre. Y los videos que NO abren reel —el detalle de una
   * publicación, los anuncios— tampoco: ésos llegan con `onTap`, que es cómo
   * `CardPostMedia` aplica la regla de `videoOpensReel`.
   */
  function openVideo() {
    // Quien monta el video puede decidirlo (el detalle de una publicación y los
    // anuncios abren el visor con sus propias diapositivas y su propio tope).
    if (onTap) {
      onTap();
      return;
    }
    // La tarjeta se calla ANTES de abrir: el reel arranca con su propio sonido y
    // dos copias del mismo clip sonando juntas no se le hace a nadie.
    videoRef.current?.pause();
    postMusic?.pause();
    setReelAbierto(true);
  }

  /** Cerrar el reel: la tarjeta retoma exactamente como al cerrar el visor. */
  function closeReel() {
    setReelAbierto(false);
    resumeAfterViewer();
  }

  /**
   * El reel no tenía nada para este post. Se cierra sin ruido y se abre el visor
   * de la publicación: la persona tocó un video y tiene que ver un video, no un
   * cartel explicando por qué el scroll no está disponible.
   */
  function reelSinContenido() {
    setReelAbierto(false);
    openViewer();
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
    // Un toque abre el video; dos toques (dentro de la ventana) dan me gusta.
    if (tapTimer.current !== null) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      handleDoubleTap();
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      openVideo();
    }, DOUBLE_TAP_MS);
  }

  /**
   * TODAVÍA NO HAY VIDEO QUE MOSTRAR (o no lo va a haber). La tarjeta ES el
   * estado: nada de capas de toque, altavoz ni píldora de vistas encima de algo
   * que no se puede reproducir — un botón "Ver el video" sobre un video que no
   * existe es peor que no tener botón.
   *
   * El guard va DESPUÉS de todos los hooks (mismo criterio que CardPostMedia):
   * un return temprano más arriba rompería su orden entre renders, y este
   * componente pasa de "procesando" a "listo" sin desmontarse.
   */
  if (modo === "processing" || modo === "errored") {
    return (
      <div className={cn("relative", className)}>
        <VideoStatusCard
          kind={modo === "errored" ? "fallo" : muxVivo.demorado ? "demorado" : "procesando"}
        />
      </div>
    );
  }

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      {modo === "mux" && muxVivo.playbackId ? (
        /**
         * EL MISMO RECTÁNGULO, OTRO ELEMENTO ADENTRO. Todo lo que se pinta
         * debajo —la capa de toque, la píldora, el corazón, el altavoz— no sabe
         * ni le importa cuál de los dos está montado: hablan con `videoRef`, que
         * es el contrato mínimo que cumplen los dos.
         */
        <MuxVideoSurface
          playbackId={muxVivo.playbackId}
          mediaRef={videoRef}
          filterCss={filterCss}
          muted={videoMuted}
          loop
          // El autoplay lo decide el observador de visibilidad de esta tarjeta
          // (60 % + 2 s), igual que con el `<video>`. Dejárselo al reproductor
          // sería un segundo criterio de cuándo arranca un video en el feed.
          autoPlay={false}
          ariaLabel={COPY.post.playVideo}
          onReady={() => setMuxMontado(true)}
          onLoadedMetadata={(seconds) => setMeasuredSeconds(seconds)}
          onTimeUpdate={(current) => {
            const node = videoRef.current;
            if (node && current >= PREVIEW_CAP_SECONDS) node.currentTime = 0;
          }}
          onError={() => setReproductorFallado(true)}
        />
      ) : (
      <video
        ref={videoRef as React.RefObject<HTMLVideoElement | null>}
        src={src}
        className="aspect-[4/5] w-full bg-surface-subtle object-cover"
        // Cadena vacía → `undefined`: sin filtro no se escribe el atributo, así
        // el elemento no queda con una capa de composición propia por nada.
        style={filterCss ? { filter: filterCss } : undefined}
        muted
        loop
        playsInline
        preload="metadata"
        // Cadena vacía → sin atributo: un `poster=""` es una imagen rota, y el
        // navegador se queda con ella en vez de mostrar el primer cuadro.
        poster={posterUrl || undefined}
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
      )}

      {/* Capa de toque: simple = visor a pantalla completa sobre el propio
          feed, doble = me gusta. */}
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

      {/* EL ALTAVOZ YA NO VIVE ACÁ. Es uno por PUBLICACIÓN y lo pinta
          `card-post-media.tsx` (`PostMusicSpeaker`), en esta misma esquina.
          Mientras estuvo acá adentro, una publicación de fotos con música no
          tenía ningún altavoz que tocar —el gesto no existía— y la canción
          nunca podía pedirse. Un altavoz por diapositiva además saltaba de
          lugar al pasar de la foto al video. */}

      {/* EL REEL, ENCIMA DEL FEED. `AnimatePresence` para que la salida se
          anime: sin él, cerrar sería un corte seco y la vuelta al feed se
          sentiría como si la app se hubiera caído en vez de como un objeto que
          se va. El chunk baja recién con el primer toque (ver `ReelOverlay`). */}
      <AnimatePresence>
        {reelAbierto && (
          <ReelOverlay
            key="reel-overlay"
            postId={postId}
            scope={scope}
            onClose={closeReel}
            onUnavailable={reelSinContenido}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
