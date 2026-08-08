import Link from "next/link";
import {
  Briefcase,
  CalendarBlank,
  House,
  Question,
  Storefront,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Avatar, Chip } from "@/components/ui";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { AdChip } from "./card-ad-chip";
import { CardLikeProvider } from "./card-like-context";
import { CardMediaProvider } from "./card-media-context";
import { CardPostMedia } from "./card-post-media";
import { PollYesNo } from "./poll-yes-no";
import { PostCaption } from "./post-caption";
import { PostActions } from "./post-actions";
import { QuestionBanner } from "./question-banner";
import { TextBanner } from "./text-banner";
import {
  entityAccentVar,
  entityHref,
  entityKindLabel,
  isPaidAdvertising,
  postKindOf,
  postMediaItems,
} from "./helpers";
import type { PostCardModel, PostEntityView, VideoScopeProp } from "./helpers";

export interface PostCardProps {
  post: PostCardModel;
  tenantId: string;
  viewerId: string | null;
  /** true en /feed/[id]: cuerpo completo, sin link al detalle. */
  isDetail?: boolean;
  /** Slot para el menú ⋯ (solo en el detalle). */
  menu?: React.ReactNode;
  /** Contexto del feed de videos para el tap sobre un video (§5). Default "para-ti". */
  videoScope?: VideoScopeProp;
  className?: string;
}

/** Ícono por vertical para la cabecera de entidad (post publicado como negocio…). */
const ENTITY_ICON: Record<string, Icon> = {
  property: House,
  business: Storefront,
  professional: UserGear,
  event: CalendarBlank,
  job: Briefcase,
};

/**
 * Chip del tipo de entidad con su acento de módulo (var(--accent-*)). El acento
 * viaja en el ícono + un tinte de fondo; el TEXTO queda en foreground para no
 * arriesgar contraste (el amarillo de "Negocio" no sería AA como texto).
 */
function EntityKindChip({ kind }: { kind: string }) {
  const KindIcon = ENTITY_ICON[kind] ?? Storefront;
  const accent = entityAccentVar(kind);
  return (
    <Chip
      variant="neutral"
      size="sm"
      className="border-transparent text-foreground"
      style={{ backgroundColor: `color-mix(in oklab, ${accent} 14%, transparent)` }}
      icon={<KindIcon weight="fill" style={{ color: accent }} aria-hidden="true" />}
    >
      {entityKindLabel(kind)}
    </Chip>
  );
}

/** Cabecera cuando el post es de una entidad: la entidad es el autor visual. */
function EntityHeader({
  entity,
  authorName,
}: {
  entity: PostEntityView;
  authorName: string;
}) {
  const href = entityHref(entity.kind, entity.id);
  const title = (
    <span className="truncate text-sm font-semibold text-foreground">{entity.title}</span>
  );
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {href ? (
          <Link
            href={href}
            className="truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            {title}
          </Link>
        ) : (
          title
        )}
        <EntityKindChip kind={entity.kind} />
      </div>
      <p className="mt-0.5 truncate text-xs text-foreground-muted">
        {COPY.post.byAuthor(authorName)}
      </p>
    </div>
  );
}

/**
 * Card de post social (§4.b) — estructuralmente distinta de un listing: avatar +
 * autor con Trust Score inline + cuerpo + FOTO/VIDEO protagonista + acciones.
 *
 * Rediseño 2026-07-21 ("diseñá pensando en una red social, no en un directorio"):
 * la foto pasa a 4:5 y ocupa el ancho COMPLETO de la card (full-bleed) — sólo la
 * cabecera y las acciones conservan su margen. Doble-tap para me gusta y un toque
 * abre el visor; el estado de me gusta se comparte entre la foto y el botón vía
 * CardLikeProvider (por eso envuelve foto + acciones). La cabecera y el cuerpo
 * son server (pasan como children del provider y no se hidratan) — esta card se
 * monta tanto desde el feed ("use client") como desde /feed/[id] (server), así
 * que NO puede tener hooks: todo estado suyo vive en los providers de abajo.
 *
 * El segundo provider, CardMediaProvider, comparte QUÉ MEDIO SE ESTÁ VIENDO
 * entre el carrusel y las acciones: la hoja de comentarios se abre según la
 * diapositiva a la vista, no según la primera del post (feedback cliente
 * 2026-07-27, dos veces en la misma call: "le bloqueó todo el video").
 *
 * Cuando el post es de una ENTIDAD, la entidad se muestra como autor y linkea a
 * su página. Si está PROMOCIONADO, se marca honesto con el chip "Publicidad"
 * (sobre la foto, o en la cabecera si no hubiera media) y, con entidad, suma el
 * CTA de campaña sobre el borde inferior de la foto (BoostCta).
 */
export function PostCard({
  post,
  tenantId,
  viewerId,
  isDetail = false,
  menu,
  videoScope = "para-ti",
  className,
}: PostCardProps) {
  /**
   * Las diapositivas del post, resueltas UNA vez acá (incluye el `photoUrl`
   * retrocompat). Van al CardMediaProvider y de ahí las leen las dos islas que
   * las necesitan: el carrusel, que las pinta, y la fila de acciones, que mira
   * cuál está a la vista para elegir la forma de la hoja de comentarios.
   */
  const mediaItems = postMediaItems(post.media, post.photoUrl);
  const hasMedia = mediaItems.length > 0;
  /**
   * Espacio PAGO — campaña vigente O video publicitario (0046). Se resuelve acá
   * arriba porque decide dos cosas a la vez: el chip de la cabecera cuando el
   * post no trae medios, y —bajando a CardPostMedia— que el video se mire
   * DENTRO del anuncio en vez de abrir el scroll de Videos Cortos.
   */
  const isAd = isPaidAdvertising(post);
  const postKind = postKindOf(post.kind);
  const isQuestion = postKind === "question";
  /**
   * `kind='text'` (2026-07-29): la MISMA idea que la pregunta, sin la forma de
   * pregunta. Nunca trae media —el trigger de la DB la exime igual que a
   * question, pero el menú de crear ni le ofrece adjuntar— así que
   * `!hasMedia` es defensivo, no una condición que vaya a fallar en la
   * práctica.
   */
  const isText = postKind === "text";
  /**
   * Una pregunta sin foto ni video quedaba como texto pelado entre cards con
   * foto a sangre (feedback cliente 2026-07-26). Su propio cuerpo pasa a ser el
   * BANNER: por eso, cuando el banner está, el párrafo de abajo no se renderiza
   * —repetiría la misma frase dos veces— y el banner cuenta como media para el
   * borde de las acciones. Una pregunta CON foto sigue el camino normal: foto
   * protagonista + su texto arriba.
   */
  const showQuestionBanner = isQuestion && !hasMedia && Boolean(post.body);
  const showTextBanner = isText && !hasMedia && Boolean(post.body);
  const showAnyBanner = showQuestionBanner || showTextBanner;

  /**
   * Encuesta Sí/No (0041). Vive DENTRO del banner cuando la pregunta es la
   * pieza gráfica — el cliente la dibujó pegada a la pregunta— y baja al cuerpo
   * de la card, en tinta de superficie, cuando la pregunta trae foto o video y
   * el banner no se renderiza. Nunca se pierde por el camino.
   */
  const poll = post.poll
    ? (
        <PollYesNo
          postId={post.id}
          poll={post.poll}
          viewerId={viewerId}
          isAuthor={Boolean(viewerId) && post.author.profileId === viewerId}
          tone={showQuestionBanner ? "media" : "surface"}
        />
      )
    : null;

  const body = showAnyBanner
    ? null
    : post.body
    ? isDetail
      ? <p className="whitespace-pre-wrap text-base leading-normal text-foreground">{post.body}</p>
      : <PostCaption text={post.body} />
    : null;

  const entity = post.entity;
  // La entidad es el autor visual → avatar con las iniciales de la entidad.
  const avatarName = entity ? entity.title : post.author.displayName;
  const avatarSrc = entity ? null : post.author.avatarUrl;

  return (
    <article
      aria-label={
        entity
          ? `Publicación de ${entity.title}`
          : `Publicación de ${post.author.displayName}`
      }
      className={cn(
        "overflow-hidden rounded-lg border bg-surface shadow-xs",
        // Contorno DORADO de contenido patrocinado (feedback cliente Geovanny,
        // 2026-08-05: "todo el contorno" tiene que gritar que es pago). Anillo
        // + borde transparente (el ring no empuja layout) más un resplandor
        // suave — el mismo lenguaje que el AdChip de card-ad-chip.tsx, nunca
        // un fondo dorado sólido (eso apagaría el contenido de adentro).
        isAd
          ? "border-transparent ring-2 ring-sponsored/70 shadow-[0_0_0_1px_var(--color-sponsored),0_10px_28px_-14px_var(--color-sponsored)]"
          : "border-border-subtle",
        className,
      )}
    >
      {/* Dos providers, dos responsabilidades: el de medios dice QUÉ SE ESTÁ
          VIENDO (lo mueve el carrusel, lo lee la fila de acciones) y el de me
          gusta comparte la reacción entre el doble toque y el botón. Ninguno
          pinta DOM: la cabecera y el cuerpo siguen siendo server. */}
      <CardMediaProvider items={mediaItems}>
        <CardLikeProvider
          postId={post.id}
          tenantId={tenantId}
          viewerId={viewerId}
          initialLiked={post.likedByViewer}
          initialCount={post.likeCount}
        >
          {/* Cabecera + cuerpo con margen; la foto de abajo va full-bleed. */}
          <div className="flex flex-col gap-2.5 px-4 pb-2.5 pt-3.5">
            <header className="flex items-start gap-2.5">
              <Avatar size="sm" name={avatarName} src={avatarSrc} />
              {entity ? (
                <EntityHeader entity={entity} authorName={post.author.displayName} />
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {post.author.displayName}
                    </span>
                    {post.author.profileId && (
                      <PublisherTrust
                        displayName={post.author.displayName}
                        firstName={firstNameOf(post.author.displayName)}
                        score={post.author.score}
                        level={post.author.level}
                        signals={post.author.signals}
                        size="inline"
                        // "Ver el perfil de…" dentro del desglose del score
                        // (call 29/7, 1:02:24). El perfil público ya existe en
                        // /perfil/[id]; acá sólo se ofrece el camino.
                        profileId={post.author.profileId}
                      />
                    )}
                  </div>
                  <p className="text-xs text-foreground-muted">{post.timeAgoLabel}</p>
                </div>
              )}
              {/* Sin media (posts viejos de texto / preguntas): el chip va en la cabecera. */}
              {isAd && !hasMedia && <AdChip />}
              {isQuestion && (
                <Chip size="sm" variant="info" icon={<Question aria-hidden="true" />}>
                  {COPY.post.questionChip}
                </Chip>
              )}
              {menu}
            </header>

            {/* timeAgo del post de entidad: bajo la cabecera para no competir con "por…" */}
            {entity && (
              <p className="text-xs text-foreground-muted">{post.timeAgoLabel}</p>
            )}

            {body}
          </div>

          {showQuestionBanner && (
            <QuestionBanner
              postId={post.id}
              question={post.body}
              isDetail={isDetail}
              footer={poll}
            />
          )}

          {showTextBanner && (
            <TextBanner postId={post.id} text={post.body} isDetail={isDetail} />
          )}

          {hasMedia && (
            <CardPostMedia
              postId={post.id}
              authorName={avatarName}
              isPromoted={post.isPromoted}
              // Las dos columnas de la 0046 que NO caducan: sin ellas, un
              // anuncio con la campaña terminada volvía a comportarse como un
              // corto cualquiera y el toque abría el reel.
              isPaidAd={post.isPaidAd}
              videoType={post.videoType}
              entity={post.entity}
              videoScope={videoScope}
              viewCount={post.viewCount}
              ctaWhatsapp={post.ctaWhatsapp}
            />
          )}

          {/* Pregunta CON foto o video: la encuesta va acá, ya en tinta de card. */}
          {poll && !showAnyBanner && (
            <div className="px-4 pb-1 pt-3">{poll}</div>
          )}

          <div
            className={cn(
              "px-2 pb-1 pt-1",
              !hasMedia && !showAnyBanner && "border-t border-border-subtle",
            )}
          >
            {/* Sin `hasVideo`: la superficie de la hoja la resuelve PostActions
                leyendo el medio a la vista. Un prop calculado acá volvería a
                congelar la decisión en el PRIMER medio del post. */}
            <PostActions
              postId={post.id}
              tenantId={tenantId}
              viewerId={viewerId}
              likeCount={post.likeCount}
              likedByViewer={post.likedByViewer}
              commentCount={post.commentCount}
              savedByViewer={post.savedByViewer}
              isDetail={isDetail}
              immersiveBackground={showAnyBanner}
            />
          </div>
        </CardLikeProvider>
      </CardMediaProvider>
    </article>
  );
}
