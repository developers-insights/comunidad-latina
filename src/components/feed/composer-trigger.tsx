"use client";

import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useComposerMenu } from "./composer-context";
import { COPY } from "./copy";

export interface ComposerTriggerProps {
  viewerName: string;
  viewerAvatarUrl: string | null;
}

/**
 * ÚNICA cosa que vive en el feed del composer (pedido de Manuel, 2026-07-29):
 * la tarjeta "¿Qué querés publicar?". El estado, los inputs de archivo y el
 * menú viven en `PostComposerHost` (montado una vez en el shell) — esta
 * tarjeta sólo abre ese menú, igual que el "+" del bottom nav (ver
 * composer-context.tsx). Antes esto era parte de `PostComposer`; se separó
 * para que el disparador pudiera quedarse ATADO al feed (sólo aparece ahí)
 * mientras el estado se vuelve alcanzable desde cualquier pantalla.
 */
export function ComposerTrigger({ viewerName, viewerAvatarUrl }: ComposerTriggerProps) {
  const { openMenu } = useComposerMenu();

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4 shadow-xs">
      <button
        type="button"
        onClick={openMenu}
        className={cn(
          "flex w-full items-center gap-3 rounded-md text-left",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <Avatar size="sm" name={viewerName} src={viewerAvatarUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-semibold text-foreground">
            {COPY.composer.createMenu.rowLabel}
          </span>
          <span className="block truncate text-sm text-foreground-secondary">
            {COPY.composer.createMenu.rowHint}
          </span>
        </span>
        <CaretRight size={18} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      </button>
    </div>
  );
}
