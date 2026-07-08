"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { sendMessageAction } from "@/app/(app)/mensajes/actions";
import { COPY } from "./copy";

const MAX_LENGTH = 2000;

/**
 * Input fijo abajo del hilo: textarea con autosize + enviar.
 * Enter envía (Shift+Enter hace salto de línea); target del botón ≥44px.
 */
export function Composer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }

  function send() {
    const body = value.trim();
    if (!body || isPending) return;

    startTransition(async () => {
      const result = await sendMessageAction({ conversationId, body });
      if (result.ok) {
        setValue("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.focus();
        }
        // Confirmación háptica sutil (§5.1) — solo si el dispositivo la soporta.
        try {
          navigator.vibrate?.(10);
        } catch {
          // sin soporte: nada que hacer
        }
        router.refresh();
      } else if (result.code === "flagged") {
        toast({
          title: COPY.composer.flaggedTitle,
          description: COPY.composer.flaggedBody,
          variant: "warning",
        });
      } else {
        toast({
          title: COPY.composer.errorTitle,
          description: COPY.composer.errorBody,
          variant: "danger",
        });
      }
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
      <label htmlFor="composer-body" className="sr-only">
        {COPY.composer.placeholder}
      </label>
      <textarea
        id="composer-body"
        ref={textareaRef}
        rows={1}
        maxLength={MAX_LENGTH}
        value={value}
        placeholder={COPY.composer.placeholder}
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
          "max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-foreground",
          "placeholder:text-foreground-muted focus:outline-none",
          "disabled:opacity-60",
        )}
      />
      <button
        type="submit"
        aria-label={COPY.composer.send}
        disabled={isPending || value.trim().length === 0}
        className={cn(
          "flex size-11 shrink-0 select-none items-center justify-center rounded-full bg-brand text-brand-foreground shadow-xs",
          "transition-[transform,background-color,opacity] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-brand-hover active:scale-[0.94]",
          "disabled:pointer-events-none disabled:opacity-45",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
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
