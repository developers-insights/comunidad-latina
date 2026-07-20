import Link from "next/link";
import {
  Briefcase,
  CalendarBlank,
  House,
  Megaphone,
  Question,
  Storefront,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Avatar, CardMedia, Chip } from "@/components/ui";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
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

/** Chip honesto de campaña paga — mismo lenguaje que "Destacado" de boosts. */
function AdChip() {
  return (
    <Chip variant="brand" size="sm" className="shrink-0">
      <Megaphone size={14} weight="fill" aria-hidden="true" />
      {COPY.post.adChip}
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
 * Card de post social (§4.b) — estructuralmente distinta de un listing:
 * avatar + autor con Trust Score SIEMPRE inline + body + acciones sociales.
 * Sin Double-Bezel a propósito: el bezel queda reservado a las tarjetas de
 * confianza (listings verificados) para que el ojo distinga por estructura.
 *
 * Cuando el post es de una ENTIDAD (feedback cliente 2026-07-19), la entidad se
 * muestra como autor (nombre + chip del vertical con su acento + "· por
 * {persona}") y linkea a su página. Cuando está PROMOCIONADO, se marca honesto
 * con el chip "Publicidad" sobre la foto (o en la cabecera si no hubiera foto).
 */
export function PostCard({
  post,
  tenantId,
  viewerId,
  isDetail = false,
  menu,
  className,
}: PostCardProps) {
  const body = (
    <p
      className={cn(
        "whitespace-pre-wrap text-base leading-normal text-foreground",
        !isDetail && "line-clamp-6",
      )}
    >
      {post.body}
    </p>
  );

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
        "rounded-lg border border-border-subtle bg-surface p-4 shadow-xs",
        className,
      )}
    >
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
        {/* Sin foto (posts viejos de texto / preguntas): el chip va en la cabecera. */}
        {post.isPromoted && !post.photoUrl && <AdChip />}
        {post.kind === "question" && (
          <Chip size="sm" variant="info" icon={<Question aria-hidden="true" />}>
            {COPY.post.questionChip}
          </Chip>
        )}
        {menu}
      </header>

      {/* timeAgo del post de entidad: bajo la cabecera para no competir con "por…" */}
      {entity && (
        <p className="mt-1 text-xs text-foreground-muted">{post.timeAgoLabel}</p>
      )}

      <div className="mt-3 flex flex-col gap-3">
        {isDetail ? (
          body
        ) : (
          <Link
            href={`/feed/${post.id}`}
            aria-label={COPY.post.openPost}
            className="rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            {body}
          </Link>
        )}

        {post.photoUrl && (
          <div className="overflow-hidden rounded-md">
            <CardMedia
              src={post.photoUrl}
              fallbackSrc={post.photoUrl}
              aspect="video"
              overlayTopRight={post.isPromoted ? <AdChip /> : undefined}
            />
          </div>
        )}
      </div>

      <PostActions
        className="mt-2 border-t border-border-subtle pt-1.5"
        postId={post.id}
        tenantId={tenantId}
        viewerId={viewerId}
        likeCount={post.likeCount}
        likedByViewer={post.likedByViewer}
        commentCount={post.commentCount}
        isDetail={isDetail}
      />
    </article>
  );
}
