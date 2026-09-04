import Link from "next/link";
import { FilmSlate, Play } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Chip } from "@/components/ui";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import type { PostCardModel } from "@/components/feed";
import { formatDuration } from "@/lib/media/video-policy";
import { cn } from "@/lib/utils";
import { VIDEOS_COPY } from "../copy";

/**
 * UNA TARJETA DE LA LISTA DE VIDEOS LARGOS.
 *
 * ---- DE DÓNDE SALE LA FORMA -----------------------------------------------
 * De la "watch page" de YouTube en iOS, mirando las capturas reales:
 * https://mobbin.com/screens/c27ee2a3-f3ba-47b1-981c-84262715889c y
 * https://mobbin.com/screens/d090eb1c-f195-483a-a894-9c8947f68423. Tres cosas se
 * tomaron de ahí y ninguna es decorativa:
 *
 *  · La MINIATURA GRANDE 16:9 manda, y la duración va como píldora abajo a la
 *    derecha ENCIMA de ella. En una sección cuya promesa es "acá el video dura",
 *    cuánto dura es el dato que decide si alguien lo abre — no un detalle del
 *    pie.
 *  · TÍTULO primero y en dos líneas, autor DESPUÉS en su propia fila. Al revés
 *    (como en el feed, donde la cabecera es el autor) la lista se leería como
 *    una lista de personas y no de videos.
 *  · Una sola línea de metadatos densa debajo del autor, con separadores "·".
 *
 * Lo que NO se copió: el botón de suscribirse ni la barra de descarga (no
 * existen en este producto), y el fondo negro plano de la miniatura vacía — acá
 * el respaldo es el mismo degradado de marca que usa el reel, nunca un hueco.
 *
 * El Trust Score va como en las tarjetas del feed, con la misma regla de
 * privacidad: si el video se publicó con la firma de un negocio, la persona
 * detrás NO se nombra (ver el docblock de `EntityHeader` en post-card.tsx).
 */

export interface LongVideoCardProps {
  post: PostCardModel;
  /**
   * `priority` en la primera tarjeta: es la imagen más grande de la pantalla y
   * casi siempre el LCP. Se pasa como booleano y no se adivina acá porque quien
   * sabe si esta tarjeta es la primera es la lista.
   */
  first?: boolean;
}

export function LongVideoCard({ post, first = false }: LongVideoCardProps) {
  const videoItem = post.media.find((item) => item.kind === "video");
  /**
   * Con Mux la propia `url` de la diapositiva YA es la miniatura que genera el
   * servicio; con el bucket, el poster es el primer cuadro capturado al subir
   * (0132). Sin ninguno de los dos no se pinta un vacío: va el respaldo.
   */
  const posterUrl =
    videoItem?.posterUrl ?? (videoItem?.muxPlaybackId ? videoItem.url : null) ?? null;
  const entity = post.entity;
  const displayTitle = entity ? entity.title : post.author.displayName;
  const title = post.body.trim() || VIDEOS_COPY.videoOf(displayTitle);
  const duration = formatDuration(post.durationSeconds);

  return (
    <li>
      <Link
        href={`/videos/largos/${post.id}`}
        aria-label={VIDEOS_COPY.largos.openVideo(title)}
        className={cn(
          "group block overflow-hidden rounded-xl bg-surface shadow-bezel",
          "transition-transform duration-(--duration-base) ease-(--ease-out-premium)",
          "active:scale-[0.99]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-media-shade">
          {/* Respaldo con los tokens de la marca: un degradado cálido sobre el
              `media-shade`, nunca negro plano. Es la diferencia entre "se
              rompió" y "ya viene". */}
          <div className="absolute inset-0 bg-[radial-gradient(115%_85%_at_50%_20%,var(--color-brand-900),var(--color-media-shade)_70%)]" />
          {posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- poster público del bucket/Mux, sin optimizador
            <img
              src={posterUrl}
              alt=""
              loading={first ? "eager" : "lazy"}
              fetchPriority={first ? "high" : "auto"}
              className={cn(
                "relative h-full w-full object-cover",
                "transition-transform duration-(--duration-slow) ease-(--ease-out-premium)",
                "group-hover:scale-[1.02]",
              )}
              draggable={false}
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center">
              <FilmSlate size={34} className="text-on-media/45" aria-hidden="true" />
            </span>
          )}

          {/* El play aparece al pasar el dedo/mouse; en reposo la miniatura es la
              que habla. Decorativo: lo que hace el toque lo dice el enlace. */}
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-0 grid place-items-center opacity-0",
              "transition-opacity duration-(--duration-base) ease-(--ease-out-premium)",
              "group-hover:opacity-100 group-focus-visible:opacity-100",
            )}
          >
            <span className="grid size-14 place-items-center rounded-full bg-media-scrim text-on-media backdrop-blur-sm">
              <Play size={24} weight="fill" />
            </span>
          </span>

          {/* Duración: el dato que decide si alguien abre un video de 5 minutos. */}
          {duration && (
            <span
              aria-hidden="true"
              className="numeric cl-print-fill absolute bottom-2 right-2 rounded-md bg-media-scrim px-1.5 py-0.5 text-xs font-semibold text-on-media backdrop-blur-sm"
            >
              {duration}
            </span>
          )}

          {post.isPromoted && (
            <span className="absolute left-2 top-2">
              <Chip variant="brand" size="sm">
                {VIDEOS_COPY.adChip}
              </Chip>
            </span>
          )}
        </div>

        <div className="px-3.5 pb-3.5 pt-3">
          <p className="line-clamp-2 font-display text-[0.9375rem] font-bold leading-snug text-foreground">
            {title}
          </p>
          <div className="mt-2 flex items-center gap-2.5">
            <Avatar
              size="sm"
              name={displayTitle}
              src={entity ? (entity.photoUrl ?? null) : post.author.avatarUrl}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {displayTitle}
              </p>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                {/* Firma de negocio ⇒ NO se nombra a la persona (misma regla de
                    privacidad que la tarjeta del feed y el reel). El Trust Score
                    es de la PERSONA, así que tampoco se pinta con firma. */}
                {entity ? null : (
                  post.author.profileId && (
                    <PublisherTrust
                      displayName={post.author.displayName}
                      firstName={firstNameOf(post.author.displayName)}
                      score={post.author.score}
                      level={post.author.level}
                      signals={post.author.signals}
                      size="inline"
                      profileId={post.author.profileId}
                    />
                  )
                )}
                <span className="shrink-0 text-xs text-foreground-muted">
                  {post.timeAgoLabel}
                </span>
                {post.viewCount > 0 && (
                  <span className="numeric shrink-0 text-xs text-foreground-muted">
                    · {VIDEOS_COPY.viewsLabel(post.viewCount)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}
