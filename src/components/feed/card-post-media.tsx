"use client";

import { useState } from "react";
import { Heart } from "@phosphor-icons/react/dist/ssr";
import { usePrefersReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";
import { attributionLine } from "@/lib/media/audio-track";
import { AdChip } from "./card-ad-chip";
import { BoostCta } from "./boost-cta";
import { useCardLike } from "./card-like-context";
import { useCardMedia } from "./card-media-context";
import { MediaCarousel } from "./media-carousel";
import { useMediaViewer } from "./media-viewer";
import { MusicBadge } from "./music-badge";
import {
  isPaidAdvertising,
  videoOpensReel,
  viewerPlaybackCapFor,
  type PostEntityView,
  type PostMusicView,
  type VideoScopeProp,
} from "./helpers";
import styles from "./card-post-media.module.css";

export interface CardPostMediaProps {
  postId: string;
  /** Nombre visible del autor/entidad para el encabezado del visor. */
  authorName: string;
  /** Campaña VIGENTE (post_promotions). Ver `isPaidAdvertising` en helpers. */
  isPromoted: boolean;
  /**
   * posts.is_paid_ad (0046). PERMANENTE, a diferencia de `isPromoted`: un
   * anuncio cuya campaña ya terminó sigue siendo un anuncio, y su video largo
   * sigue teniendo que mirarse acá adentro.
   */
  isPaidAd?: boolean;
  /** posts.video_type (0046): 'advertising_video' = el video es de una campaña. */
  videoType?: string | null;
  entity: PostEntityView | null;
  /** Contexto del feed de videos para el tap sobre un video. */
  videoScope: VideoScopeProp;
  /** Vistas acumuladas del post (píldora sobre el video). */
  viewCount?: number;
  /** WhatsApp de la campaña, si la entidad lo publicó (CTA de post promocionado). */
  ctaWhatsapp?: string | null;
  /** Pista asociada a la publicación (0090). null = sin música → sin badge. */
  music?: PostMusicView | null;
}

/**
 * Medios protagonistas del post (§1, §3, §5, §6): ocupan el ancho completo de la
 * card (full-bleed) en relación 4:5 y son lo primero que el ojo ve — "diseñá
 * pensando en una red social, no en un directorio".
 *
 * Desde el feedback del 2026-07-27 esto es un CARRUSEL: un post puede traer
 * varias fotos, varios videos, o una mezcla en cualquier orden, y se pasan
 * deslizando de costado con sus puntitos abajo (ver media-carousel.tsx, que es
 * quien resuelve el riel, el snap, los puntitos y el teclado).
 *
 * Este módulo se queda con lo que va POR ENCIMA de todos los medios y con el
 * estado compartido de la card:
 *  - el chip honesto "Publicidad" y el CTA de campaña (BoostCta);
 *  - el corazón grande del doble toque, que reusa el me gusta del post
 *    (useCardLike) para que la foto y el botón muevan el MISMO contador.
 *
 * Las diapositivas y el índice visible NO son suyos: viven en el contexto de
 * medios de la card (card-media-context), porque la fila de acciones necesita
 * leer el mismo dato para elegir la forma de la hoja de comentarios. Acá se lo
 * consume y se lo mueve; el visor abre en el medio que se estaba viendo —desde
 * la tercera foto, en la tercera— porque lee exactamente ese índice.
 */
export function CardPostMedia({
  postId,
  authorName,
  isPromoted,
  isPaidAd = false,
  videoType = null,
  entity,
  videoScope,
  viewCount = 0,
  ctaWhatsapp = null,
  music = null,
}: CardPostMediaProps) {
  const reduce = usePrefersReducedMotion();
  const viewer = useMediaViewer();
  const like = useCardLike();
  const media = useCardMedia();
  const [bursts, setBursts] = useState(0);

  // Sin provider no hay card que pintar (y sin medios, tampoco). El guard va
  // DESPUÉS de todos los hooks: un return temprano antes rompería su orden.
  if (!media || media.items.length === 0) return null;
  const { items, index, setIndex } = media;

  /**
   * ¿Este post es un espacio PAGO? Una sola pregunta para las dos consecuencias
   * —el chip y el ruteo del video— porque separarlas es cómo se llega a un
   * anuncio que se marca pero se comporta como contenido orgánico.
   *
   * OJO con la diferencia entre las tres señales: `isPromoted` es la campaña
   * VIGENTE y se apaga sola cuando termina; `isPaidAd`/`videoType` son lo que
   * el post ES, y no caducan. Mirar sólo la primera era el agujero: un
   * `advertising_video` con la campaña terminada seguía abriendo el reel.
   */
  const paidAd = { isPromoted, isPaidAd, videoType };
  const isAd = isPaidAdvertising(paidAd);
  const showBoostCta = isPromoted && Boolean(entity);
  /**
   * El visor a pantalla completa SOBRE esta misma publicación: se abre acá y al
   * cerrar —termine solo, atrás, la X o deslizando hacia abajo— volvés a la
   * card, en la misma posición del feed (es un overlay, no una navegación; el
   * bloqueo de scroll es `overflow:hidden`, que conserva el scrollTop).
   *
   * El tope de reproducción lo decide la superficie, no el componente: 600 s
   * dentro de un anuncio, 300 s en el detalle (ver `viewerPlaybackCapFor`, que
   * lee los números de video-policy).
   */
  const openViewerAt = (startIndex: number) =>
    viewer.open({
      items,
      startIndex,
      postId,
      authorName,
      maxPlaybackSeconds: viewerPlaybackCapFor(paidAd),
    });
  /**
   * Sin reel por DOS motivos distintos, y los dos terminan igual: el video se
   * abre a pantalla completa sobre esta misma publicación y al cerrar volvés acá.
   * La regla vive en `videoOpensReel` (helpers) para que el reel y la tarjeta no
   * puedan opinar distinto.
   */
  const reelDisabled = !videoOpensReel({ scope: videoScope, post: paidAd });

  function handleDoubleTap() {
    if (!like) return;
    // El corazón grande es feedback visual: se muestra cuando hay sesión (aunque
    // el post ya estuviera likeado, como Instagram). Sin sesión, likeOnce lleva
    // a /entrar y no mostramos un corazón que mentiría un me gusta inexistente.
    if (like.canReact) setBursts((current) => current + 1);
    like.likeOnce();
  }

  return (
    <div className="relative">
      <MediaCarousel
        items={items}
        index={index}
        onIndexChange={setIndex}
        postId={postId}
        authorName={authorName}
        videoScope={videoScope}
        viewCount={viewCount}
        // El visor abre EN EL MEDIO QUE SE ESTABA VIENDO: pasar tres fotos y
        // tocar la tercera tiene que abrir la tercera.
        onPhotoTap={openViewerAt}
        onPhotoDoubleTap={handleDoubleTap}
        onVideoTap={reelDisabled ? openViewerAt : undefined}
        // Con campaña paga, la barra del CTA ocupa el borde inferior: los
        // puntitos suben para no quedar debajo.
        dotsClassName={showBoostCta ? "bottom-[3.75rem]" : undefined}
        // La pista, para que el video de ESTE post (si lo hay) la reproduzca
        // sincronizada. Es la misma para todas las diapositivas: la música es
        // del POST, no de un medio en particular (post_music, PK post_id).
        music={music}
      />

      {/* Divulgación honesta (FTC): el chip acompaña a TODO espacio pago, no
          sólo a la campaña vigente. Un video publicitario cuya campaña terminó
          sigue siendo publicidad mientras está publicado. */}
      {isAd && (
        <div className="absolute right-2.5 top-2.5 z-[3]">
          <AdChip />
        </div>
      )}

      {/* Insignia de música (0090): sobre CUALQUIER medio (foto o video), no
          por diapositiva — la pista es del post entero. Abajo a la izquierda,
          simétrica al AdChip (arriba a la derecha). Con CTA de campaña activo
          la barra de BoostCta ocupa todo el borde inferior: la insignia sube
          exactamente lo mismo que ya suben los puntitos del carrusel
          (`dotsClassName` arriba) — mismo valor, misma regla, no una nueva. */}
      {music && (
        <div
          className={cn(
            "pointer-events-none absolute left-2.5 z-[3]",
            showBoostCta ? "bottom-[3.75rem]" : "bottom-3",
          )}
        >
          <MusicBadge
            title={music.track.title}
            artist={music.track.artist}
            attribution={attributionLine(music.track)}
          />
        </div>
      )}

      {/* Corazón grande del doble-tap (decorativo; el estado lo comunica el botón).
          `cl-print-hide`: es la ÚNICA tinta `on-media` que escribe este archivo y
          es un destello — vive lo que dura la animación. En papel, un corazón
          blanco sin su relleno queda en 1.00:1, y aun con la foto detrás sería
          ruido sobre una hoja que alguien imprimió para leer. No va nunca. */}
      {bursts > 0 && (
        <span
          className="cl-print-hide pointer-events-none absolute inset-0 z-[3] grid place-items-center"
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

      {showBoostCta && entity && (
        <BoostCta
          kind={entity.kind}
          entityId={entity.id}
          postId={postId}
          ctaWhatsapp={ctaWhatsapp}
          className="z-[3]"
        />
      )}
    </div>
  );
}
