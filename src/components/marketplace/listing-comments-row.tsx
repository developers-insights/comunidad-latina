"use client";

import { CaretRight, ChatCircle } from "@phosphor-icons/react/dist/ssr";
import { useCommentsSheet } from "@/components/feed/comments-sheet";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

const C = COPY.detail;

/**
 * Fila "Comentarios (N)" del detalle de un aviso. Abre la hoja polimórfica del
 * feed EN EL LUGAR, en su modo listing — mismo criterio que el feed (feedback
 * cliente 2026-07-21: comentar no puede sacarte de la pantalla). La hoja es de
 * otro paquete: acá no se toca, sólo se la llama.
 */
export function ListingCommentsRow({
  listingId,
  commentCount,
  className,
}: {
  listingId: string;
  commentCount: number;
  className?: string;
}) {
  const { open } = useCommentsSheet();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => open({ listingId, commentCount })}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-lg border border-border-subtle bg-surface px-4 py-3",
          "text-left transition-colors duration-(--duration-fast) hover:bg-surface-subtle",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <ChatCircle size={20} aria-hidden="true" className="shrink-0 text-foreground-secondary" />
        <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
          {C.commentsCta(commentCount)}
        </span>
        <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      </button>
      <p className="mt-1.5 px-1 text-xs text-foreground-muted">{C.commentsHint}</p>
    </div>
  );
}
