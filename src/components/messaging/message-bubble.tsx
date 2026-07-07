import { cn } from "@/lib/utils";

/**
 * Burbuja de mensaje (server-safe): propias a la derecha con marca suave,
 * ajenas a la izquierda sobre superficie neutra (§4 wireframes).
 * El body es SIEMPRE texto plano (React lo escapa) — nunca HTML.
 */
export function MessageBubble({
  body,
  isOwn,
  timeLabel,
}: {
  body: string;
  isOwn: boolean;
  timeLabel: string;
}) {
  return (
    <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5",
          isOwn
            ? "rounded-br-md bg-brand-50 text-foreground"
            : "rounded-bl-md bg-surface-subtle text-foreground",
        )}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {body}
        </p>
        <p
          className={cn(
            "mt-1 text-[10px] text-foreground-muted",
            isOwn ? "text-right" : "text-left",
          )}
        >
          {timeLabel}
        </p>
      </div>
    </div>
  );
}
