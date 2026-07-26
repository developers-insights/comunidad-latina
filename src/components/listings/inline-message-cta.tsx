"use client";

import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ChatTeardropText,
  CheckCircle,
  PaperPlaneRight,
} from "@phosphor-icons/react/dist/ssr";
import { Button, Spinner, buttonVariants, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { sendListingMessageAction } from "@/app/(app)/mensajes/inline-actions";

/**
 * MENSAJE INLINE (call con el cliente 2026-07-24: "quiero escribirle sin salir
 * de la publicación").
 *
 * Un botón que, en vez de navegar, ABRE ahí mismo un mini-composer con la misma
 * gramática visual que el hilo de Mensajes (ver components/messaging/composer):
 * textarea con autosize, Enter envía / Shift+Enter salta, botón redondo de 44px.
 * Al enviar, el bloque se colapsa a "Enviado · Seguilo en Mensajes" — la
 * conversación sigue viva donde corresponde, pero la persona nunca perdió la
 * publicación que estaba mirando.
 *
 * El contacto NO se abarata: por debajo sigue siendo `request_contact` (la
 * conversación nace pendiente y el receptor decide si acepta). Esto sólo cambia
 * DÓNDE se escribe el primer mensaje.
 *
 * El COPY vive acá, local al componente, y no en `./copy.ts`: este archivo es
 * el único nuevo del paquete en /components/listings y el copy compartido de
 * ese módulo lo está tocando otro agente en paralelo. Un solo dueño por archivo.
 */

const MAX_LENGTH = 2000;

export const INLINE_MESSAGE_COPY = {
  cta: "Mensaje",
  fieldLabel: "Escribí tu mensaje",
  placeholder: "Hola, me interesa. ¿Sigue disponible?",
  send: "Enviar mensaje",
  cancel: "Cancelar",
  hint: "Se abre un chat privado. Nunca compartas datos bancarios ni contraseñas.",
  successTitle: "Mensaje enviado",
  successBody: "Te avisamos acá apenas te respondan.",
  sentLabel: "Enviado",
  sentLink: "Seguilo en Mensajes",
  loginCta: "Entrar a mi cuenta",
  errors: {
    self: "Es tu propia publicación — no podés escribirte a vos.",
    blocked: "No podemos entregar este mensaje.",
    unauthenticated: "Se cerró tu sesión. Entrá de nuevo y lo mandamos.",
    "tenant-mismatch": "Algo no cuadra con tu sesión. Salí y volvé a entrar.",
    invalid: "Escribí un poquito más antes de enviarlo.",
    error: "No pudimos enviarlo — no es tu culpa. Probá de nuevo en un ratito.",
  },
} as const;

/** Alias interno: el nombre exportado es largo a propósito (lo leen los tests). */
const COPY = INLINE_MESSAGE_COPY;

type ErrorCode = keyof typeof COPY.errors;

export interface InlineMessageCtaProps {
  /** Aviso al que se le escribe (producto, tienda o evento). */
  listingId: string;
  isLoggedIn: boolean;
  /** Ruta a la que volver después de entrar — la pantalla actual. */
  nextPath: string;
  /** Texto del botón colapsado. Default: "Mensaje". */
  label?: string;
  /** Placeholder contextual del mini-composer. */
  placeholder?: string;
  className?: string;
}

export function InlineMessageCta({
  listingId,
  isLoggedIn,
  nextPath,
  label = COPY.cta,
  placeholder = COPY.placeholder,
  className,
}: InlineMessageCtaProps) {
  const { toast } = useToast();
  const fieldId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [phase, setPhase] = useState<"idle" | "open" | "sent">("idle");
  const [value, setValue] = useState("");
  const [error, setError] = useState<{ text: string; needsLogin: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Sin sesión no hay composer que valga: el camino honesto es entrar y volver.
  if (!isLoggedIn) {
    return (
      <div className={className}>
        {/* buttonVariants y no clases sueltas: ese <a> con pinta de botón ya
            trae el hook `cl-print-hide` (un control impreso no lleva a ningún
            lado — ver src/test/print-contract.test.ts). */}
        <Link
          href={`/entrar?next=${encodeURIComponent(nextPath)}`}
          className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
        >
          <ChatTeardropText size={20} aria-hidden="true" />
          {label}
        </Link>
        <p className="mt-1.5 text-center text-xs text-foreground-muted">{COPY.hint}</p>
      </div>
    );
  }

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }

  function expand() {
    setError(null);
    setPhase("open");
    // El foco llega después del render del textarea.
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function collapse() {
    setPhase("idle");
    setError(null);
  }

  function send() {
    const body = value.trim();
    if (!body || isPending) return;

    startTransition(async () => {
      const result = await sendListingMessageAction({ listingId, body });

      if (result.ok) {
        setValue("");
        setError(null);
        setPhase("sent");
        toast({
          title: COPY.successTitle,
          description: COPY.successBody,
          variant: "success",
        });
        try {
          navigator.vibrate?.(10);
        } catch {
          // sin soporte háptico: nada que hacer
        }
        return;
      }

      // El texto lo elegimos acá y no `result.message`: el error tiene que
      // leerse igual en todas las pantallas que montan este bloque.
      const code = normalizeCode(result.code);
      setError({ text: COPY.errors[code], needsLogin: code === "unauthenticated" });
      if (code === "self") setPhase("idle");
    });
  }

  if (phase === "sent") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-success/20 bg-success-bg px-4 py-3",
          className,
        )}
      >
        <CheckCircle size={20} weight="fill" aria-hidden="true" className="shrink-0 text-success" />
        <p className="text-sm font-semibold text-success-ink">{COPY.sentLabel}</p>
        <span aria-hidden="true" className="text-success-ink/60">
          ·
        </span>
        <Link
          href="/mensajes"
          className={cn(
            "text-sm font-semibold text-foreground underline underline-offset-2",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          {COPY.sentLink}
        </Link>
      </div>
    );
  }

  return (
    <div className={className}>
      {phase === "idle" ? (
        <>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            aria-expanded={false}
            onClick={expand}
          >
            <ChatTeardropText size={20} aria-hidden="true" />
            {label}
          </Button>
          <p className="mt-1.5 text-center text-xs text-foreground-muted">{COPY.hint}</p>
        </>
      ) : (
        <div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
            className="flex items-end gap-2 rounded-2xl border border-border bg-surface-raised p-2 shadow-sm"
          >
            <label htmlFor={fieldId} className="sr-only">
              {COPY.fieldLabel}
            </label>
            <textarea
              id={fieldId}
              ref={textareaRef}
              rows={1}
              maxLength={MAX_LENGTH}
              value={value}
              placeholder={placeholder}
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
              aria-label={COPY.send}
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

          <div className="mt-1.5 flex items-start justify-between gap-3">
            <p className="text-xs text-foreground-muted">{COPY.hint}</p>
            <button
              type="button"
              onClick={collapse}
              className={cn(
                "shrink-0 text-xs font-semibold text-foreground-secondary underline underline-offset-2",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
            >
              {COPY.cancel}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error.text}{" "}
          {error.needsLogin && (
            <Link
              href={`/entrar?next=${encodeURIComponent(nextPath)}`}
              className="font-semibold underline underline-offset-2"
            >
              {COPY.loginCta}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

/** Normaliza el code del contrato a una clave de COPY.errors (defensivo). */
function normalizeCode(code: string): ErrorCode {
  return code in COPY.errors ? (code as ErrorCode) : "error";
}
