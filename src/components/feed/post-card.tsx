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
import { CardPostMedia } from "./card-post-media";
import { PostActions } from "./post-actions";
import { entityAccentVar, entityHref, entityKindLabel } from "./helpers";
import type { PostCardModel, PostEntityView } from "./helpers";

export interface PostCardProps {
  post: PostCardModel;
  tenantId: string;
  viewerId: string | null;
  /** true en /feed/[id]: cuerpo completo, sin link al detalle. */
  isDetail?: boolean;
  /** Slot para el menú ⋯ (solo en el detalle). */
  menu?: React.ReactNode;
  /** Contexto del feed de videos para el tap sobre un video (§5). Default "para-ti". */
  videoScope?: string;
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
 * son server (pasan como children del provider y no se hidratan).
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
  const hasMedia = post.media.length > 0 || Boolean(post.photoUrl);

  const bodyText = (
    <p
      className={cn(
        "whitespace-pre-wrap text-base leading-normal text-foreground",
        !isDetail && "line-clamp-6",
      )}
    >
      {post.body}
    </p>
  );
  const body = post.body
    ? isDetail
      ? bodyText
      : (
          <Link
            href={`/feed/${post.id}`}
            aria-label={COPY.post.openPost}
            className="rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            {bodyText}
          </Link>
        )
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
        "overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-xs",
        className,
      )}
    >
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
                    />
                  )}
                </div>
                <p className="text-xs text-foreground-muted">{post.timeAgoLabel}</p>
              </div>
            )}
            {/* Sin media (posts viejos de texto / preguntas): el chip va en la cabecera. */}
            {post.isPromoted && !hasMedia && <AdChip />}
            {post.kind === "question" && (
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

        {hasMedia && (
          <CardPostMedia
            postId={post.id}
            authorName={avatarName}
            media={post.media}
            photoUrl={post.photoUrl}
            isPromoted={post.isPromoted}
            entity={post.entity}
            videoScope={videoScope}
          />
        )}

        <div
          className={cn(
            "px-2 pb-1 pt-1",
            !hasMedia && "border-t border-border-subtle",
          )}
        >
          <PostActions
            postId={post.id}
            tenantId={tenantId}
            viewerId={viewerId}
            likeCount={post.likeCount}
            likedByViewer={post.likedByViewer}
            commentCount={post.commentCount}
            isDetail={isDetail}
          />
        </div>
      </CardLikeProvider>
    </article>
  );
}
