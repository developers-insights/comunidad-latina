"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

const LONG_CAPTION = 300;

/**
 * Texto de una publicación CON foto/video, en el feed (no en el detalle).
 * Antes un toque simple navegaba a `/feed/[id]` — el mismo bug ya corregido en
 * QuestionBanner y TextBanner (feedback cliente: "nunca saca del feed"). Acá
 * el arreglo es el mismo: expandir en el lugar en vez de navegar. Mismo
 * umbral (`LONG_CAPTION`) que `LONG_TEXT` en text-banner.tsx.
 */
export function PostCaption({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const showMore = !expanded && text.trim().length > LONG_CAPTION;

  return (
    <div>
      <p
        className={cn(
          "whitespace-pre-wrap text-base leading-normal text-foreground",
          !expanded && "line-clamp-6",
        )}
      >
        {text}
      </p>
      {showMore && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-0.5 rounded-sm text-sm font-semibold text-foreground-secondary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          {COPY.post.textReadFull}
        </button>
      )}
    </div>
  );
}
