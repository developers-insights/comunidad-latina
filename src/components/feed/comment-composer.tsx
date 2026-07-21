"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneRight } from "@phosphor-icons/react/dist/ssr";
import { Spinner, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { TENANT_GUARD_COPY } from "@/lib/tenant/match";
import { createCommentAction } from "@/app/(app)/feed/actions";
import { COPY } from "./copy";

const MAX_LENGTH = 1000;

/**
 * Ciclo de vida del envío en modo OPTIMISTA (hoja de comentarios del feed): el
 * composer avisa al contenedor para que pinte el comentario al instante y luego
 * lo reconcilie con el resultado de moderación. Sin esto, el composer se comporta
 * como en el detalle: publica y hace `router.refresh()`.
 */
export interface CommentOptimisticHandlers {
  /** Se disparó el envío: pintá el comentario ya (con estado "enviando"). */
  onStart: (draft: { tempId: string; body: string }) => void;
  /** El servidor lo aceptó (published): confirmá el optimista. */
  onPublished: (tempId: string) => void;
  /** Rechazo/errores (flagged, tenant, error): sacá el optimista de la lista. */
  onRejected: (tempId: string) => void;
}

export interface CommentComposerProps {
  postId: string;
  /** Deshabilita el input (p.ej. mientras la hoja carga el hilo o su auth). */
  disabled?: boolean;
  /**
   * Modo optimista. Si viene, el composer NO navega (no saca al usuario del
   * feed — el pedido literal del cliente): reporta el ciclo de vida y deja que
   * el contenedor maneje la lista. Ausente → comportamiento del detalle SSR.
   */
  optimistic?: CommentOptimisticHandlers;
}

/**
 * Composer de comentario — misma moderación que el post (el server action pasa
 * el texto por moderateText antes de publicar). Dos modos: el del detalle SSR
 * (`router.refresh()`) y el optimista de la hoja del feed (ver `optimistic`).
 */
export function CommentComposer({ postId, disabled = false, optimistic }: CommentComposerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // id único por instancia: en el feed pueden coexistir esta hoja global y el
  // composer del detalle — un id fijo rompería la asociación label/textarea.
  const fieldId = useId();

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }

  function resetField(focus: boolean) {
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      if (focus) textareaRef.current.focus();
    }
  }

  function haptic() {
    try {
      navigator.vibrate?.(10);
    } catch {
      // sin soporte háptico
    }
  }

  function send() {
    const body = value.trim();
    if (!body || isPending || disabled) return;

    // Optimista: limpiamos el campo YA y avisamos para pintar el comentario en
    // el acto. Si el servidor lo rechaza, devolvemos el texto para reintentar.
    const tempId = optimistic ? crypto.randomUUID() : "";
    if (optimistic) {
      optimistic.onStart({ tempId, body });
      resetField(false);
    }

    startTransition(async () => {
      const result = await createCommentAction({ postId, body });
      if (result.ok) {
        if (optimistic) {
          optimistic.onPublished(tempId);
        } else {
          resetField(true);
          router.refresh();
        }
        haptic();
        return;
      }

      // Falla: en modo optimista revertimos el pintado y recuperamos el texto.
      if (optimistic) {
        optimistic.onRejected(tempId);
        setValue(body);
      }

      if (result.code === "unauthenticated") {
        router.push(`/entrar?next=${encodeURIComponent(`/feed/${postId}`)}`);
        return;
      }
      if (result.code === "tenant-mismatch") {
        toast({
          title: TENANT_GUARD_COPY.mismatchTitle,
          description: result.message,
          variant: "warning",
          duration: 8000,
        });
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
      className={cn(
        "flex items-end gap-2 rounded-2xl border border-border bg-surface-raised p-2 shadow-sm",
        // El anillo de foco vive en el FORM, no en el textarea: así sigue la
        // píldora en vez de dibujar un rectángulo que no empalma con la card
        // (el textarea apaga su outline, y sin esto no quedaba NINGÚN indicador
        // visible de foco — el navegador ponía el suyo, cuadrado).
        "transition-shadow duration-(--duration-fast)",
        "focus-within:ring-[3px] focus-within:ring-focus-ring",
      )}
    >
      <label htmlFor={fieldId} className="sr-only">
        {COPY.comments.placeholder}
      </label>
      <textarea
        id={fieldId}
        ref={textareaRef}
        rows={1}
        maxLength={MAX_LENGTH}
        value={value}
        placeholder={COPY.comments.placeholder}
        disabled={isPending || disabled}
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
          "placeholder:text-foreground-muted focus:outline-none focus-visible:outline-none",
          "disabled:opacity-60",
        )}
      />
      <button
        type="submit"
        aria-label={COPY.comments.send}
        disabled={isPending || disabled || value.trim().length === 0}
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
