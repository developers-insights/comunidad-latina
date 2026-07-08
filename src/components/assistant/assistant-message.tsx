"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CaretRight,
  Compass,
  ThumbsDown,
  ThumbsUp,
} from "@phosphor-icons/react";
import { BezelCard, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AssistantAction, AssistantSource } from "./protocol";
import { ASSISTANT_COPY as COPY } from "./copy";

/**
 * Burbujas de la conversación (§4.e): usuario a la derecha con marca suave,
 * asistente a la izquierda en neutro con su avatar de brújula (nunca un
 * "robot IA" genérico). Las respuestas renderizan texto plano + BezelCards
 * de fuente citada + botones de derivación + feedback 👍/👎.
 */

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      sources: AssistantSource[];
      actions: AssistantAction[];
      /** id de assistant_queries (evento "start") — habilita el feedback. */
      queryId: string | null;
      status: "streaming" | "done";
    };

/** Indicador de escritura: skeleton-dots (§5.2 — nunca spinner centrado). */
function TypingDots() {
  return (
    <span
      role="status"
      aria-label={COPY.typing}
      className="flex items-center gap-1.5 py-1.5"
    >
      {[0, 180, 360].map((delay) => (
        <span
          key={delay}
          aria-hidden="true"
          className="size-2 animate-pulse rounded-full bg-foreground-muted"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/** Tarjeta de fuente citada — título + destino + descriptor legal §11. */
function SourceCard({ source }: { source: AssistantSource }) {
  return (
    <Link
      href={source.href}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
    >
      <BezelCard coreClassName="flex items-center gap-3 p-3.5">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {source.title}
          </span>
          <span className="mt-0.5 block text-xs text-foreground-secondary">
            {source.descriptor}
          </span>
        </span>
        <CaretRight
          size={16}
          aria-hidden="true"
          className="shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5"
        />
      </BezelCard>
    </Link>
  );
}

/** Feedback 👍/👎 → POST /api/assistant/feedback (fire-and-forget). */
function FeedbackRow({ queryId }: { queryId: string }) {
  const [voted, setVoted] = useState<"up" | "down" | null>(null);

  function vote(helpful: boolean) {
    setVoted(helpful ? "up" : "down");
    void fetch("/api/assistant/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queryId, helpful }),
    }).catch(() => undefined); // feedback jamás molesta al usuario si falla
  }

  if (voted) {
    return (
      <p aria-live="polite" className="mt-1 text-xs text-foreground-muted">
        {COPY.feedback.thanks}
      </p>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-1">
      <span className="text-xs text-foreground-muted">{COPY.feedback.question}</span>
      <button
        type="button"
        onClick={() => vote(true)}
        aria-label={COPY.feedback.up}
        className="touch-hitbox flex size-8 items-center justify-center rounded-full text-foreground-muted transition-[color,transform] duration-(--duration-fast) ease-(--ease-spring) hover:text-success active:scale-[0.9] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <ThumbsUp size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => vote(false)}
        aria-label={COPY.feedback.down}
        className="touch-hitbox flex size-8 items-center justify-center rounded-full text-foreground-muted transition-[color,transform] duration-(--duration-fast) ease-(--ease-spring) hover:text-danger active:scale-[0.9] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <ThumbsDown size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-brand-tint px-4 py-2.5 text-base text-foreground">
          {message.text}
        </p>
      </li>
    );
  }

  const thinking = message.status === "streaming" && message.text.length === 0;

  return (
    <li className="flex items-end gap-2">
      {/* Avatar propio del asistente: brújula, nunca "robot IA" genérico */}
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
      >
        <Compass size={18} />
      </span>

      <div className="min-w-0 max-w-[85%] flex-1">
        {/* aria-live: el lector de pantalla anuncia la respuesta a medida que
            llega el streaming (antes solo se oía el "escribiendo"). */}
        <div
          aria-live="polite"
          aria-atomic="false"
          className="rounded-lg rounded-bl-sm border border-border-subtle bg-surface px-4 py-2.5 shadow-xs"
        >
          {thinking ? (
            <TypingDots />
          ) : (
            <p className="whitespace-pre-wrap text-base text-foreground">
              {message.text}
            </p>
          )}
        </div>

        {message.sources.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-xs font-medium text-foreground-muted">
              {COPY.sources.heading}
            </p>
            {message.sources.map((source) => (
              <SourceCard key={source.href} source={source} />
            ))}
          </div>
        )}

        {message.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.actions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                {action.label}
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}

        {message.status === "done" && message.queryId && (
          <FeedbackRow queryId={message.queryId} />
        )}
      </div>
    </li>
  );
}
