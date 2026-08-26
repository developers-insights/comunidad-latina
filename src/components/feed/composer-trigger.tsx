"use client";

import { CaretRight, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useComposerMenu } from "./composer-context";
import { COPY } from "./copy";

export interface ComposerTriggerProps {
  /** Nombre de la CARA activa: el negocio si se está actuando como negocio. */
  viewerName: string;
  viewerAvatarUrl: string | null;
  /**
   * El negocio con el que se está actuando, o null = sos vos. Cambia la
   * segunda línea de la tarjeta y le pone la insignia al avatar: la promesa de
   * "acá dice con qué perfil estás" tiene que sostenerse también en el único
   * lugar del feed donde se empieza a publicar, no sólo arriba en el header.
   */
  negocio?: { nombre: string } | null;
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
export function ComposerTrigger({
  viewerName,
  viewerAvatarUrl,
  negocio = null,
}: ComposerTriggerProps) {
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
        <Avatar
          size="sm"
          name={viewerName}
          src={viewerAvatarUrl}
          badge={
            negocio ? (
              <span
                aria-hidden="true"
                className="cl-print-hide flex size-3.5 items-center justify-center rounded-full bg-brand text-brand-foreground ring-2 ring-surface"
              >
                <Storefront size={9} weight="fill" />
              </span>
            ) : undefined
          }
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-semibold text-foreground">
            {COPY.composer.createMenu.rowLabel}
          </span>
          <span
            className={cn(
              "block truncate text-sm",
              negocio ? "font-medium text-brand-ink" : "text-foreground-secondary",
            )}
          >
            {negocio
              ? COPY.composer.createMenu.rowHintNegocio(negocio.nombre)
              : COPY.composer.createMenu.rowHint}
          </span>
        </span>
        <CaretRight size={18} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      </button>
    </div>
  );
}
