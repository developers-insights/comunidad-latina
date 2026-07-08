import Image from "next/image";
import Link from "next/link";
import { Question } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Chip } from "@/components/ui";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import { isOptimizableSrc } from "@/components/listings/helpers";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { PostActions } from "./post-actions";
import type { PostCardModel } from "./helpers";

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

/**
 * Card de post social (§4.b) — estructuralmente distinta de un listing:
 * avatar + autor con Trust Score SIEMPRE inline + body + acciones sociales.
 * Sin Double-Bezel a propósito: el bezel queda reservado a las tarjetas de
 * confianza (listings verificados) para que el ojo distinga por estructura.
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

  return (
    <article
      aria-label={`Publicación de ${post.author.displayName}`}
      className={cn(
        "rounded-lg border border-border-subtle bg-surface p-4 shadow-xs",
        className,
      )}
    >
      <header className="flex items-start gap-2.5">
        <Avatar size="sm" name={post.author.displayName} src={post.author.avatarUrl} />
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
        {post.kind === "question" && (
          <Chip size="sm" variant="info" icon={<Question aria-hidden="true" />}>
            {COPY.post.questionChip}
          </Chip>
        )}
        {menu}
      </header>

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
          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-surface-subtle">
            {isOptimizableSrc(post.photoUrl) ? (
              <Image
                src={post.photoUrl}
                alt=""
                fill
                sizes="(max-width: 512px) 100vw, 512px"
                className="object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- URL externa fuera del allowlist de next/image
              <img
                src={post.photoUrl}
                alt=""
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
              />
            )}
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
