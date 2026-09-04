"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { enviarMensajeAlGrupoAction } from "@/app/(app)/mensajes/grupos/actions";
import { LIMITES } from "@/lib/messaging/grupos";
import { COPY } from "./copy";

/**
 * Composer del chat de grupo.
 *
 * Es el gemelo de `composer.tsx` (chat 1-a-1) y se copia en vez de compartirse
 * a propósito: la diferencia no es sólo la action —cambian el placeholder, el
 * copy de error y el caso "el grupo se cerró mientras escribías", que en un
 * directo no existe—. Un componente con un `if (esGrupo)` en cada rama sería
 * más largo que los dos juntos y más difícil de tocar sin romper el otro.
 */
export function GroupComposer({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [valor, setValor] = useState("");
  const [enviando, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }

  function enviar() {
    const body = valor.trim();
    if (!body || enviando) return;

    startTransition(async () => {
      const resultado = await enviarMensajeAlGrupoAction({ groupId, body });

      if (resultado.ok) {
        setValor("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.focus();
        }
        // Confirmación háptica sutil (§5.1) — sólo si el dispositivo la soporta.
        try {
          navigator.vibrate?.(10);
        } catch {
          // sin soporte: nada que hacer
        }
        router.refresh();
        return;
      }

      if (resultado.code === "flagged") {
        toast({
          title: COPY.composer.flaggedTitle,
          description: COPY.composer.flaggedBody,
          variant: "warning",
        });
        return;
      }
      if (resultado.code === "rate-limited") {
        toast({
          title: COPY.composer.rateLimitedTitle,
          description: COPY.groups.rateLimited,
          variant: "warning",
        });
        return;
      }
      if (resultado.code === "forbidden") {
        // Te sacaron del grupo o lo cerraron mientras tenías la pantalla
        // abierta. Se refresca para que la pantalla deje de mentir en vez de
        // dejar el composer ahí, listo para fallar otra vez.
        toast({ title: COPY.groups.closedBanner, variant: "warning" });
        router.refresh();
        return;
      }
      toast({
        title: COPY.composer.errorTitle,
        description: COPY.composer.errorBody,
        variant: "danger",
      });
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        enviar();
      }}
      className="flex items-end gap-2 rounded-2xl border border-border bg-surface-raised p-2 shadow-sm"
    >
      <label htmlFor="group-composer-body" className="sr-only">
        {COPY.groups.composerPlaceholder}
      </label>
      <textarea
        id="group-composer-body"
        ref={textareaRef}
        rows={1}
        maxLength={LIMITES.mensajeMax}
        value={valor}
        placeholder={COPY.groups.composerPlaceholder}
        disabled={enviando}
        onChange={(event) => {
          setValor(event.target.value);
          autosize(event.target);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            enviar();
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
        disabled={enviando || valor.trim().length === 0}
        className={cn(
          "flex size-11 shrink-0 select-none items-center justify-center rounded-full bg-brand text-brand-foreground shadow-xs cl-print-hide",
          "transition-[transform,background-color,opacity] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-brand-hover active:scale-[0.94]",
          "disabled:pointer-events-none disabled:opacity-45",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        {enviando ? (
          <Spinner size={18} />
        ) : (
          <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}
