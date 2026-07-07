"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChatCircle, Heart, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui";
import { LikeBurst } from "@/components/motion";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

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

const actionClass = cn(
  "flex min-h-11 min-w-11 select-none items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground-secondary",
  "transition-[transform,color,background-color] duration-(--duration-fast) ease-(--ease-spring)",
  "hover:bg-surface-subtle active:scale-[0.94]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]",
);

/**
 * Acciones subordinadas de un post (§4.b): like optimista (insert/delete en
 * reactions — los triggers de DB mantienen like_count), comentarios y
 * compartir. Island chiquita: el resto de la card es server component.
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
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [liked, setLiked] = useState(likedByViewer);
  const [count, setCount] = useState(likeCount);
  const [, startTransition] = useTransition();

  function toggleLike(nextLiked: boolean) {
    if (!viewerId) {
      router.push(`/entrar?next=${encodeURIComponent(pathname || "/feed")}`);
      return;
    }

    // Optimista: la UI responde <100ms; si la DB dice que no, se revierte.
    setLiked(nextLiked);
    setCount((current) => Math.max(0, current + (nextLiked ? 1 : -1)));
    try {
      navigator.vibrate?.(10);
    } catch {
      // sin soporte háptico: nada que hacer
    }

    startTransition(async () => {
      const supabase = createClient();
      if (nextLiked) {
        const { error } = await supabase.from("reactions").insert({
          tenant_id: tenantId,
          subject_kind: "post",
          subject_id: postId,
          profile_id: viewerId,
          kind: "like",
        });
        // 23505 = ya existía la reacción (doble tap rápido): el estado ya es correcto.
        if (error && error.code !== "23505") {
          setLiked(false);
          setCount((current) => Math.max(0, current - 1));
        }
      } else {
        const { error } = await supabase
          .from("reactions")
          .delete()
          .eq("subject_kind", "post")
          .eq("subject_id", postId)
          .eq("profile_id", viewerId);
        if (error) {
          setLiked(true);
          setCount((current) => current + 1);
        }
      }
    });
  }

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
      <ChatCircle size={18} aria-hidden="true" />
      <span className="numeric">{commentCount}</span>
    </>
  );

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span className={cn("flex items-center", liked && "text-danger")}>
        <LikeBurst
          active={liked}
          onToggle={toggleLike}
          label={liked ? COPY.post.unlike : COPY.post.like}
          particleColor="var(--color-danger)"
          className={cn(actionClass, "pr-1", liked && "text-danger")}
        >
          <Heart
            size={18}
            weight={liked ? "fill" : "regular"}
            aria-hidden="true"
          />
          <span className="numeric">{count}</span>
        </LikeBurst>
      </span>

      {isDetail ? (
        <span className={cn(actionClass, "hover:bg-transparent active:scale-100")} aria-label={COPY.post.comments}>
          {commentsContent}
        </span>
      ) : (
        <Link
          href={`/feed/${postId}`}
          aria-label={`${COPY.post.comments} (${commentCount})`}
          className={actionClass}
        >
          {commentsContent}
        </Link>
      )}

      <button
        type="button"
        onClick={share}
        aria-label={COPY.post.share}
        className={cn(actionClass, "ml-auto")}
      >
        <ShareNetwork size={18} aria-hidden="true" />
        <span className="hidden sm:inline">{COPY.post.share}</span>
      </button>
    </div>
  );
}
