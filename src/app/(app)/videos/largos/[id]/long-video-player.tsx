"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookmarkSimple,
  ChatCircle,
  Heart,
  Megaphone,
  ShareNetwork,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, Chip, useToast } from "@/components/ui";
import { LikeBurst } from "@/components/motion";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import { useCommentsSheet, type PostCardModel } from "@/components/feed";
/**
 * `ViewerVideo` entra por ruta directa y no por el barril del feed, igual que
 * en el reel: el barril arrastra la hoja de comentarios entera (Supabase + las
 * actions del marketplace) y acá sólo hace falta el reproductor.
 */
import { ViewerVideo } from "@/components/feed/media-viewer";
import { MusicBadge } from "@/components/feed/music-badge";
import { recordPostViewAction } from "@/app/(app)/feed/engagement-actions";
import { attributionLine } from "@/lib/media/audio-track";
import { formatDuration, longVideoCapSeconds } from "@/lib/media/video-policy";
import { cn } from "@/lib/utils";
import { VIDEOS_COPY } from "../../copy";
import { useReelLike, useReelSave } from "../../video-reels";

/**
 * EL VIDEO LARGO, COMPLETO (cliente 2026-09-03, 19:40–23:44): "una sección de
 * los videos largos donde la gente vaya a ver su video de 5 minutos… le das
 * click y empieza a ver el video completo".
 *
 * ---- DE DÓNDE SALE LA FORMA -----------------------------------------------
 * De la "watch page" de YouTube en iOS, mirando las capturas reales
 * (https://mobbin.com/screens/c27ee2a3-f3ba-47b1-981c-84262715889c). Tres cosas
 * se tomaron de ahí:
 *
 *  · El reproductor arriba, a lo ancho, sobre su banda oscura, y la información
 *    empieza JUSTO abajo sobre la superficie clara de la app. El video manda y
 *    todo lo demás es su pie.
 *  · Las acciones en una FILA horizontal de píldoras, no en el riel vertical del
 *    reel. En un reel el riel derecho existe porque el pulgar está deslizando y
 *    la pantalla es del video; acá la persona ya llegó, está quieta y leyendo:
 *    la fila se escanea de un vistazo y no tapa la imagen.
 *  · Una sola línea de metadatos con separadores "·" debajo del título.
 *
 * Lo que NO se copió: el botón de suscribirse (no existe acá) y el fondo negro
 * plano detrás del video — el respaldo es el degradado de marca del reel.
 *
 * ---- LO QUE SE REUSA Y POR QUÉ --------------------------------------------
 * El reproductor es `ViewerVideo` —el mismo del visor y del reel— y el me gusta
 * y el guardado son `useReelLike` / `useReelSave`, los mismos hooks del reel.
 * No es economía de líneas: un me gusta que acá fuera optimista y allá no, o que
 * acá mandara a /entrar y allá abriera la hoja, sería la misma acción
 * comportándose distinto según por dónde entraste.
 *
 * ---- SIN `PostMusicProvider`, A PROPÓSITO ---------------------------------
 * En el feed y en el reel, una publicación con canción manda callar al video
 * (regla 2 de `audio-mix`). Acá no: un video largo es una recorrida de una casa
 * con alguien hablando, y pisarle la voz con la pista de fondo de una
 * publicación sería romper justamente lo que la persona vino a ver. El audio del
 * video ES el contenido.
 */

export interface LongVideoPlayerProps {
  post: PostCardModel;
  tenantId: string;
  viewerId: string | null;
}

export function LongVideoPlayer({ post, tenantId, viewerId }: LongVideoPlayerProps) {
  const { toast } = useToast();
  const commentsSheet = useCommentsSheet();
  const like = useReelLike({ post, tenantId, viewerId });
  const save = useReelSave({ post, viewerId });
  /**
   * Arranca CON sonido: llegar acá fue un gesto (el botón "Ver video completo",
   * o una tarjeta de la lista). Si el navegador igual rechaza el autoplay con
   * audio, `ViewerVideo` cae a mudo solo y el altavoz queda a un toque.
   */
  const [muted, setMuted] = useState(false);

  const videoItem = post.media.find((item) => item.kind === "video");
  const posterUrl =
    videoItem?.posterUrl ?? (videoItem?.muxPlaybackId ? videoItem.url : null) ?? null;
  const entity = post.entity;
  const displayTitle = entity ? entity.title : post.author.displayName;
  const title = post.body.trim() || VIDEOS_COPY.videoOf(displayTitle);
  const duration = formatDuration(post.durationSeconds);

  /**
   * La vista, una sola vez por montaje. `fire-and-forget`: si la acción falla, la
   * pantalla ni se entera (la PK de la tabla además deduplica por día).
   */
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    void recordPostViewAction({ postId: post.id }).catch(() => undefined);
  }, [post.id]);

  async function share() {
    // El link que se comparte es el de ESTA pantalla, no el del post en el feed:
    // quien lo reciba tiene que caer donde el video se ve entero.
    const url = `${window.location.origin}/videos/largos/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({
        title: VIDEOS_COPY.shareCopiedTitle,
        description: VIDEOS_COPY.shareCopiedBody,
        variant: "success",
      });
    } catch {
      // El usuario canceló el share nativo — no es un error.
    }
  }

  if (!videoItem) return null;

  return (
    <article>
      {/* El reproductor sale del padding de la columna para ir a lo ancho: es la
          pieza principal y un margen a los costados lo volvería una miniatura
          grande. 16:9 porque un video largo es una recorrida, no un vertical. */}
      <div className="-mx-4 -mt-5 aspect-video w-full overflow-hidden bg-media-shade">
        <ViewerVideo
          url={videoItem.url}
          muxPlaybackId={videoItem.muxPlaybackId}
          active
          muted={muted}
          onMutedChange={setMuted}
          authorLabel={VIDEOS_COPY.largos.fullVideoLabel(displayTitle)}
          posterUrl={posterUrl}
          // Se va a ver entero: pedir sólo la metadata sería hacer esperar dos
          // veces (una para saber que hay video, otra para verlo).
          preload="auto"
          /**
           * ACÁ SÍ, EL VIDEO COMPLETO: 600 s si es publicitario, 300 s si no
           * (`longVideoCapSeconds`). Es lo contrario de las otras superficies —
           * el feed, el visor y el reel muestran 59 s y mandan para acá— y es
           * literalmente lo que promete el botón que trajo a la persona.
           *
           * Que haya tope y no "el archivo entero" importa por los videos
           * anteriores a la 0046: su duración es desconocida.
           */
          maxPlaybackSeconds={longVideoCapSeconds(post.videoType)}
        />
      </div>

      <div className="pt-4">
        <h1 className="font-display text-lg font-bold leading-snug text-foreground">
          {title}
        </h1>

        {/* Una sola línea de metadatos, con "·" — el patrón de la referencia. */}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-foreground-muted">
          {post.viewCount > 0 && (
            <span className="numeric">{VIDEOS_COPY.viewsLabel(post.viewCount)}</span>
          )}
          {post.viewCount > 0 && <span aria-hidden="true">·</span>}
          <span>{post.timeAgoLabel}</span>
          {duration && (
            <>
              <span aria-hidden="true">·</span>
              <span className="numeric">{duration}</span>
            </>
          )}
          {post.isPromoted && (
            <Chip variant="brand" size="sm" className="ml-1">
              <Megaphone size={14} weight="fill" aria-hidden="true" />
              {VIDEOS_COPY.adChip}
            </Chip>
          )}
        </p>

        {/* Autor con su Trust Score, con la MISMA regla de privacidad del feed y
            del reel: con firma de negocio la persona detrás no se nombra. */}
        <div className="mt-3.5 flex items-center gap-2.5">
          <Avatar
            size="md"
            name={displayTitle}
            src={entity ? (entity.photoUrl ?? null) : post.author.avatarUrl}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {displayTitle}
            </p>
            {!entity && post.author.profileId && (
              <div className="mt-0.5 flex min-w-0">
                <PublisherTrust
                  displayName={post.author.displayName}
                  firstName={firstNameOf(post.author.displayName)}
                  score={post.author.score}
                  level={post.author.level}
                  signals={post.author.signals}
                  size="inline"
                  profileId={post.author.profileId}
                />
              </div>
            )}
          </div>
        </div>

        {post.music && (
          <div className="mt-3 flex">
            <MusicBadge
              title={post.music.track.title}
              artist={post.music.track.artist}
              attribution={attributionLine(post.music.track)}
            />
          </div>
        )}

        {/* Fila de acciones. Scrollea con el dedo si no entra —nunca sola— y
            cada píldora respeta el mínimo de 44 px de alto. */}
        <div className="-mx-4 mt-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max items-center gap-2">
            <span className={cn("flex", like.liked && "text-danger")}>
              <LikeBurst
                active={like.liked}
                onToggle={like.toggle}
                label={like.liked ? VIDEOS_COPY.unlike : VIDEOS_COPY.like}
                particleColor="var(--color-danger)"
                className={cn(pillClass, like.liked && "text-danger")}
              >
                <Heart
                  size={18}
                  weight={like.liked ? "fill" : "regular"}
                  aria-hidden="true"
                />
                <span className="numeric">{like.count}</span>
              </LikeBurst>
            </span>

            <button
              type="button"
              onClick={() =>
                commentsSheet.open({
                  postId: post.id,
                  commentCount: post.commentCount,
                })
              }
              aria-label={`${VIDEOS_COPY.comments} (${post.commentCount})`}
              className={pillClass}
            >
              <ChatCircle size={18} aria-hidden="true" />
              <span className="numeric">{post.commentCount}</span>
            </button>

            <button
              type="button"
              onClick={save.toggle}
              aria-label={save.saved ? VIDEOS_COPY.unsave : VIDEOS_COPY.save}
              aria-pressed={save.saved}
              className={pillClass}
            >
              <BookmarkSimple
                size={18}
                weight={save.saved ? "fill" : "regular"}
                aria-hidden="true"
              />
              {save.saved ? VIDEOS_COPY.saved : VIDEOS_COPY.save}
            </button>

            <button
              type="button"
              onClick={share}
              aria-label={VIDEOS_COPY.share}
              className={pillClass}
            >
              <ShareNetwork size={18} aria-hidden="true" />
              {VIDEOS_COPY.share}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Píldora de acción de la fila (el equivalente horizontal del riel del reel). */
const pillClass = cn(
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface-subtle px-4",
  "text-sm font-semibold text-foreground",
  "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.96]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);
