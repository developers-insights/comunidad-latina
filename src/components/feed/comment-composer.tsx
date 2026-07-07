"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneRight } from "@phosphor-icons/react/dist/ssr";
import { Spinner, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createCommentAction } from "@/app/(app)/feed/actions";
import { COPY } from "./copy";

const MAX_LENGTH = 1000;

/**
 * Composer de comentario del detalle de post — misma moderación que el post:
 * el server action pasa el texto por moderateText antes de publicar.
 */
export function CommentComposer({ postId }: { postId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }

  function send() {
    const body = value.trim();
    if (!body || isPending) return;

    startTransition(async () => {
      const result = await createCommentAction({ postId, body });
      if (result.ok) {
        setValue("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.focus();
        }
        try {
          navigator.vibrate?.(10);
        } catch {
          // sin soporte háptico
        }
        router.refresh();
        return;
      }
      if (result.code === "unauthenticated") {
        router.push(`/entrar?next=${encodeURIComponent(`/feed/${postId}`)}`);
        return;
      }
      if (result.code === "flagged") {
        toast({
          title: COPY.comments.flaggedTitle,
          description: COPY.comments.flaggedBody,
          variant: "warning",
        });
        return;
      }
      toast({
        title: COPY.comments.errorTitle,
        description: COPY.comments.errorBody,
        variant: "danger",
      });
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      className="flex items-end gap-2 rounded-2xl border border-border bg-surface-raised p-2 shadow-sm"
    >
      <label htmlFor="comment-composer-body" className="sr-only">
        {COPY.comments.placeholder}
      </label>
      <textarea
        id="comment-composer-body"
        ref={textareaRef}
        rows={1}
        maxLength={MAX_LENGTH}
        value={value}
        placeholder={COPY.comments.placeholder}
        disabled={isPending}
        onChange={(event) => {
          setValue(event.target.value);
          autosize(event.target);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
        className={cn(
          "max-h-36 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-foreground",
          "placeholder:text-foreground-muted focus:outline-none",
          "disabled:opacity-60",
        )}
      />
      <button
        type="submit"
        aria-label={COPY.comments.send}
        disabled={isPending || value.trim().length === 0}
        className={cn(
          "flex size-11 shrink-0 select-none items-center justify-center rounded-full bg-brand text-brand-foreground shadow-xs",
          "transition-[transform,background-color,opacity] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-brand-700 active:scale-[0.94]",
          "disabled:pointer-events-none disabled:opacity-45",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]",
        )}
      >
        {isPending ? (
          <Spinner size={18} />
        ) : (
          <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}
