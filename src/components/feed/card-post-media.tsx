"use client";

import { useEffect, useRef, useState } from "react";
import { Heart, Images } from "@phosphor-icons/react/dist/ssr";
import { CardMedia } from "@/components/ui";
import { usePrefersReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";
import { AdChip } from "./card-ad-chip";
import { BoostCta } from "./boost-cta";
import { useCardLike } from "./card-like-context";
import { CardVideo } from "./card-video";
import { useMediaViewer } from "./media-viewer";
import { COPY } from "./copy";
import type { PostEntityView, PostMediaView } from "./helpers";
import styles from "./card-post-media.module.css";

/** Ventana para distinguir un toque simple de un doble toque (§3). */
const DOUBLE_TAP_MS = 250;

export interface CardPostMediaProps {
  postId: string;
  /** Nombre visible del autor/entidad para el encabezado del visor. */
  authorName: string;
  /** Medios del post en orden; el primero manda (foto grande o video). */
  media: PostMediaView[];
  /** Retrocompat: primera foto si `media` viene vacío (posts viejos). */
  photoUrl: string | null;
  isPromoted: boolean;
  entity: PostEntityView | null;
  /** Contexto del feed de videos para el tap sobre un video. */
  videoScope: string;
}

/**
 * Foto/video protagonista del post (§1, §3, §5, §6). La foto ocupa el ancho
 * completo de la card (full-bleed) en relación 4:5 y es lo primero que el ojo
 * ve — "diseñá pensando en una red social, no en un directorio".
 *
 * Interacción tipo Instagram sobre la FOTO:
 *  - un toque abre el visor a pantalla completa (contrato useMediaViewer);
 *  - doble toque da me gusta (corazón grande animado en el centro) reusando el
 *    estado compartido del post (useCardLike). El doble-tap es EXTRA: el botón de
 *    me gusta de PostActions sigue siendo el camino accesible.
 * Si el primer medio es VIDEO, delega en CardVideo (autoplay al ver + tap→/videos).
 * Si hay varias fotos, muestra un indicador de cantidad y el toque abre el visor.
 */
export function CardPostMedia({
  postId,
  authorName,
  media,
  photoUrl,
  isPromoted,
  entity,
  videoScope,
}: CardPostMediaProps) {
  const reduce = usePrefersReducedMotion();
  const viewer = useMediaViewer();
  const like = useCardLike();
  const [bursts, setBursts] = useState(0);
  const tapTimer = useRef<number | null>(null);

  // Si la card se desmonta con un toque en vuelo (scroll rápido), no dejar que el
  // timer abra el visor de una card que ya no está.
  useEffect(
    () => () => {
      if (tapTimer.current !== null) clearTimeout(tapTimer.current);
    },
    [],
  );

  // Normalizamos: si no hay `media` nueva pero sí `photoUrl` (posts previos a
  // 0025), la tratamos como una única foto.
  const items: PostMediaView[] =
    media.length > 0
      ? media
      : photoUrl
        ? [{ kind: "image", url: photoUrl }]
        : [];

  if (items.length === 0) return null;

  const first = items[0];
  const photoCount = items.filter((item) => item.kind === "image").length;

  // VIDEO como primer medio: card de video. Igual mantiene el chip "Publicidad"
  // y, si es campaña, el CTA de la entidad sobre el borde inferior.
  if (first.kind === "video") {
    return (
      <div className="relative">
        <CardVideo src={first.url} postId={postId} scope={videoScope} />
        {isPromoted && (
          <div className="absolute right-2.5 top-2.5">
            <AdChip />
          </div>
        )}
        {isPromoted && entity && (
          <BoostCta kind={entity.kind} entityId={entity.id} postId={postId} />
        )}
      </div>
    );
  }

  function openViewer(index = 0) {
    viewer.open({ items, startIndex: index, postId, authorName });
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
    // Un toque abre el visor; dos toques (dentro de la ventana) dan me gusta.
    if (tapTimer.current !== null) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      handleDoubleTap();
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      openViewer(0);
    }, DOUBLE_TAP_MS);
  }

  return (
    <div className="relative">
      <CardMedia
        src={first.url}
        fallbackSrc={first.url}
        aspect="portrait"
        quality={62}
      />

      {/* Capa de toque sobre la foto: simple = visor, doble = me gusta. Es un
          botón real (accesible por teclado: Enter abre el visor); el doble-tap
          es un extra táctil, nunca el único camino al me gusta. */}
      <button
        type="button"
        onClick={handleTap}
        aria-label={COPY.post.openPhoto}
        className="absolute inset-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring"
      />

      {/* Indicador de varias fotos (arriba-izq, para no chocar con "Publicidad"). */}
      {photoCount > 1 && (
        <span
          className="cl-print-fill pointer-events-none absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-media-scrim px-2 py-0.5 text-xs font-semibold text-on-media"
          aria-hidden="true"
        >
          <Images size={13} weight="fill" />
          {photoCount}
        </span>
      )}

      {isPromoted && (
        <div className="absolute right-2.5 top-2.5">
          <AdChip />
        </div>
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

      {isPromoted && entity && (
        <BoostCta kind={entity.kind} entityId={entity.id} postId={postId} />
      )}
    </div>
  );
}
