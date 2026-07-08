"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Compass, PaperPlaneRight } from "@phosphor-icons/react";
import {
  BezelCard,
  Button,
  ProximamentePremium,
  buttonVariants,
  fieldControlClass,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { MessageBubble, type ChatMessage } from "./assistant-message";
import { parseAssistantEvent, type AssistantAction } from "./protocol";
import { ASSISTANT_COPY as COPY } from "./copy";

/**
 * Conversación del Asistente Comunitario (§4.e del design brief, TAL CUAL):
 * estado inicial con ilustración de brújula + chips que pre-llenan el input,
 * burbujas usuario/asistente, skeleton-dots mientras busca, input fijo abajo
 * (sobre la bottom-nav), respuestas con fuentes citadas + derivación +
 * feedback. Anónimos: 3 preguntas → invitación cálida a crear cuenta.
 */

export interface AssistantChatProps {
  /** true si no hay sesión — activa el límite de invitado. */
  isAnon: boolean;
  /** Preguntas de invitado restantes al cargar (null para logueados). */
  initialAnonRemaining: number | null;
}

const MIN_QUESTION = 3;
const MAX_QUESTION = 500;

const FALLBACK_RATE_ACTIONS: AssistantAction[] = [
  { label: "Leer las guías completas", href: "/guias" },
];

export function AssistantChat({ isAnon, initialAnonRemaining }: AssistantChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [anonRemaining, setAnonRemaining] = useState<number | null>(
    isAnon ? initialAnonRemaining : null,
  );
  const [aiDown, setAiDown] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const limitReached = isAnon && anonRemaining !== null && anonRemaining <= 0;

  // Auto-scroll al último mensaje (respetando prefers-reduced-motion).
  useEffect(() => {
    if (messages.length === 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "end",
    });
  }, [messages]);

  function patchAssistant(
    id: string,
    updates: Partial<Extract<ChatMessage, { role: "assistant" }>>,
  ) {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === id && message.role === "assistant"
          ? { ...message, ...updates }
          : message,
      ),
    );
  }

  function appendAssistantText(id: string, text: string) {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === id && message.role === "assistant"
          ? { ...message, text: message.text + text }
          : message,
      ),
    );
  }

  /** Cierra la burbuja con calidez pase lo que pase (nunca error crudo). */
  function finishWithFallback(id: string, fallbackText: string) {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === id && message.role === "assistant"
          ? {
              ...message,
              text: message.text.length > 0 ? message.text : fallbackText,
              status: "done" as const,
            }
          : message,
      ),
    );
  }

  async function send(raw: string) {
    const question = raw.trim();
    if (question.length < MIN_QUESTION || isStreaming || limitReached || aiDown) return;

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: question },
      {
        id: assistantId,
        role: "assistant",
        text: "",
        sources: [],
        actions: [],
        queryId: null,
        status: "streaming",
      },
    ]);
    setInput("");
    setIsStreaming(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      if (response.status === 429) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (body?.error === "anon_limit") {
          setAnonRemaining(0);
          patchAssistant(assistantId, {
            text: COPY.anon.limitBubble,
            status: "done",
          });
        } else {
          patchAssistant(assistantId, {
            text: COPY.errors.rateLimit,
            actions: FALLBACK_RATE_ACTIONS,
            status: "done",
          });
        }
        return;
      }

      if (response.status === 503) {
        // OpenAI sin configurar → estado premium, jamás un error técnico.
        setAiDown(true);
        return;
      }

      if (!response.ok || !response.body) {
        finishWithFallback(assistantId, COPY.errors.generic);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;
          const event = parseAssistantEvent(line);
          if (!event) continue;

          switch (event.t) {
            case "start":
              patchAssistant(assistantId, { queryId: event.queryId });
              break;
            case "delta":
              appendAssistantText(assistantId, event.text);
              break;
            case "sources":
              patchAssistant(assistantId, { sources: event.sources });
              break;
            case "actions":
              patchAssistant(assistantId, { actions: event.actions });
              break;
            case "done":
              finished = true;
              patchAssistant(assistantId, { status: "done" });
              if (isAnon) {
                setAnonRemaining((current) =>
                  current === null ? current : Math.max(0, current - 1),
                );
              }
              break;
            case "error":
              finished = true;
              finishWithFallback(assistantId, COPY.errors.generic);
              break;
          }
        }
      }

      if (!finished) finishWithFallback(assistantId, COPY.errors.generic);
    } catch {
      finishWithFallback(assistantId, COPY.errors.generic);
    } finally {
      setIsStreaming(false);
    }
  }

  if (aiDown) {
    return <ProximamentePremium feature="el asistente comunitario" className="mt-2" />;
  }

  const canSend =
    input.trim().length >= MIN_QUESTION && !isStreaming && !limitReached;

  return (
    <div className="flex flex-1 flex-col">
      {messages.length === 0 ? (
        /* Estado inicial: nunca un input vacío intimidante (§4.e) */
        <div className="flex flex-col items-center gap-3 px-2 pb-6 pt-6 text-center">
          <span
            aria-hidden="true"
            className="flex size-20 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
          >
            <Compass size={40} weight="light" />
          </span>
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            {COPY.hero.title}
          </h2>
          <p className="max-w-[40ch] text-sm text-foreground-secondary">
            {COPY.hero.subtitle}
          </p>

          <p className="mt-4 w-full text-left text-sm font-medium text-foreground-secondary">
            {COPY.hero.tryLabel}
          </p>
          <div className="flex w-full flex-col gap-2">
            {COPY.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setInput(suggestion);
                  inputRef.current?.focus();
                }}
                className={cn(
                  "min-h-11 rounded-md border border-border bg-surface px-4 py-3 text-left text-sm text-foreground shadow-xs",
                  "transition-[transform,border-color,background-color] duration-(--duration-fast) ease-(--ease-spring)",
                  "hover:border-brand-subtle hover:bg-brand-tint/40 active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                “{suggestion}”
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="flex flex-col gap-4 pb-4 pt-2" aria-label={COPY.header.subtitle}>
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </ol>
      )}

      <div ref={bottomRef} aria-hidden="true" />

      {/* Input fijo abajo, siempre visible sobre la bottom-nav (§4.e) */}
      <div
        className="sticky z-30 -mx-4 mt-auto border-t border-border-subtle bg-canvas/95 px-4 pb-2 pt-3 backdrop-blur-sm"
        style={{ bottom: "calc(56px + env(safe-area-inset-bottom, 0px))" }}
      >
        {limitReached ? (
          /* Invitación cálida — el límite nunca se siente como castigo */
          <BezelCard variant="featured" coreClassName="flex flex-col gap-3 p-5">
            <div>
              <h2 className="font-display text-lg font-bold text-foreground">
                {COPY.anon.limitTitle}
              </h2>
              <p className="mt-1 text-sm text-foreground-secondary">
                {COPY.anon.limitBody}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                href="/registro"
                className={buttonVariants({ variant: "primary", size: "sm" })}
              >
                {COPY.anon.limitCta}
              </Link>
              <Link
                href="/entrar?next=/asistente"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                {COPY.anon.limitSecondary}
              </Link>
            </div>
          </BezelCard>
        ) : (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send(input);
              }}
              className="flex items-center gap-2"
            >
              <label htmlFor="assistant-question" className="sr-only">
                {COPY.input.label}
              </label>
              <input
                id="assistant-question"
                ref={inputRef}
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={COPY.input.placeholder}
                maxLength={MAX_QUESTION}
                autoComplete="off"
                enterKeyHint="send"
                className={cn(fieldControlClass, "h-12 min-w-0 flex-1 rounded-full px-5")}
              />
              <Button
                type="submit"
                variant="primary"
                size="md"
                aria-label={COPY.input.send}
                disabled={!canSend}
                className="size-12 shrink-0 p-0"
              >
                <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
              </Button>
            </form>
            {isAnon && anonRemaining !== null && anonRemaining < 3 && anonRemaining > 0 && (
              <p className="mt-1.5 text-center text-xs text-foreground-muted">
                {COPY.anon.remaining(anonRemaining)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
