"use client";

import { useState } from "react";
import { Heart } from "@phosphor-icons/react/dist/ssr";
import { usePrefersReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";
import { AdChip } from "./card-ad-chip";
import { BoostCta } from "./boost-cta";
import { useCardLike } from "./card-like-context";
import { useCardMedia } from "./card-media-context";
import { NO_REEL_SCOPE } from "./card-video";
import { MediaCarousel } from "./media-carousel";
import { useMediaViewer } from "./media-viewer";
import type { PostEntityView, VideoScopeProp } from "./helpers";
import styles from "./card-post-media.module.css";

export interface CardPostMediaProps {
  postId: string;
  /** Nombre visible del autor/entidad para el encabezado del visor. */
  authorName: string;
  isPromoted: boolean;
  entity: PostEntityView | null;
  /** Contexto del feed de videos para el tap sobre un video. */
  videoScope: VideoScopeProp;
  /** Vistas acumuladas del post (píldora sobre el video). */
  viewCount?: number;
  /** WhatsApp de la campaña, si la entidad lo publicó (CTA de post promocionado). */
  ctaWhatsapp?: string | null;
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
  entity,
  videoScope,
  viewCount = 0,
  ctaWhatsapp = null,
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

  const showBoostCta = isPromoted && Boolean(entity);
  /**
   * Pantallas que muestran UNA publicación (el detalle) no tienen reel: el video
   * se abre a pantalla completa dentro del propio post y el "atrás" devuelve a
   * donde estabas. El scroll infinito de videos vive sólo en /feed y /videos.
   */
  const openViewerAt = (startIndex: number) =>
    viewer.open({ items, startIndex, postId, authorName });
  const reelDisabled = videoScope === NO_REEL_SCOPE;

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
      />

      {isPromoted && (
        <div className="absolute right-2.5 top-2.5 z-[3]">
          <AdChip />
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
