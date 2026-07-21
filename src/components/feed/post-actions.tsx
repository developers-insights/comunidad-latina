"use client";

import { ChatCircle, Heart, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import { useToast } from "@/components/ui";
import { LikeBurst } from "@/components/motion";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { useCardLike, useOptimisticLike } from "./card-like-context";
import { useCommentsSheet } from "./comments-sheet";

export interface PostActionsProps {
  postId: string;
  tenantId: string;
  /** id del usuario logueado, o null si es anónimo. */
  viewerId: string | null;
  likeCount: number;
  likedByViewer: boolean;
  commentCount: number;
  /** true en el detalle: el botón de comentarios no navega, solo informa. */
  isDetail?: boolean;
  className?: string;
}

/** Botones grandes y táctiles (§4): íconos 22px, 44px de área, feedback al toque. */
const ICON = 22;

const actionClass = cn(
  "flex min-h-11 min-w-11 select-none items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-foreground-secondary",
  "transition-[transform,color,background-color] duration-(--duration-fast) ease-(--ease-spring)",
  "hover:bg-surface-subtle active:scale-[0.94]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

/**
 * Acciones sociales de un post (§4.b): me gusta optimista, comentarios y
 * compartir. Island chiquita — el resto de la card es server component.
 *
 * El estado de me gusta se COMPARTE con el doble-tap de la foto vía
 * useCardLike() (Instagram: tocar la foto y tocar el corazón mueven el mismo
 * contador). Si la card se usara fuera de un CardLikeProvider, cae a un estado
 * propio (useOptimisticLike) para no romper.
 *
 * El botón de comentarios YA NO navega a /feed/[id] (feedback cliente 2026-07-21:
 * "que abran desde abajo, tipo Instagram"): abre el sheet vía useCommentsSheet().
 * En el detalle sigue siendo informativo (los comentarios ya están en la página).
 */
export function PostActions({
  postId,
  tenantId,
  viewerId,
  likeCount,
  likedByViewer,
  commentCount,
  isDetail = false,
  className,
}: PostActionsProps) {
  const { toast } = useToast();
  const commentsSheet = useCommentsSheet();

  // Estado compartido si hay provider; si no, propio (ambos hooks se llaman
  // siempre para respetar las reglas de hooks — el no usado es inofensivo).
  const shared = useCardLike();
  const own = useOptimisticLike({
    postId,
    tenantId,
    viewerId,
    initialLiked: likedByViewer,
    initialCount: likeCount,
  });
  const like = shared ?? own;

  async function share() {
    const url = `${window.location.origin}/feed/${postId}`;
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({
        title: COPY.post.shareCopiedTitle,
        description: COPY.post.shareCopiedBody,
        variant: "success",
      });
    } catch {
      // El usuario canceló el share nativo — no es un error.
    }
  }

  const commentsContent = (
    <>
      <ChatCircle size={ICON} aria-hidden="true" />
      <span className="numeric">{commentCount}</span>
    </>
  );

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <span className={cn("flex items-center", like.liked && "text-danger")}>
        <LikeBurst
          active={like.liked}
          onToggle={like.toggle}
          label={like.liked ? COPY.post.unlike : COPY.post.like}
          particleColor="var(--color-danger)"
          className={cn(actionClass, "pr-1.5", like.liked && "text-danger")}
        >
          <Heart
            size={ICON}
            weight={like.liked ? "fill" : "regular"}
            aria-hidden="true"
          />
          <span className="numeric">{like.count}</span>
        </LikeBurst>
      </span>

      {isDetail ? (
        <span
          className={cn(actionClass, "hover:bg-transparent active:scale-100")}
          aria-label={COPY.post.comments}
        >
          {commentsContent}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => commentsSheet.open({ postId, commentCount })}
          aria-label={`${COPY.post.comments} (${commentCount})`}
          className={actionClass}
        >
          {commentsContent}
        </button>
      )}

      <button
        type="button"
        onClick={share}
        aria-label={COPY.post.share}
        className={cn(actionClass, "ml-auto")}
      >
        <ShareNetwork size={ICON} aria-hidden="true" />
        <span className="hidden sm:inline">{COPY.post.share}</span>
      </button>
    </div>
  );
}
