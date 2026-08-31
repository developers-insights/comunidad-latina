"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Smiley } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import type { CommunityEmoji } from "@/lib/emojis/catalog";
import { useCommunityEmojis } from "@/lib/emojis/use-community-emojis";
import { EmojiPicker, type UnicodeEmojiGroup } from "./emoji-picker";
import { EMOJI_COPY } from "./copy";

/**
 * EL PICKER, FLOTANDO SOBRE UN CAMPO DE TEXTO.
 *
 * Envuelve a `EmojiPicker` con lo único que el editor de fotos no necesita:
 * un botón que lo abre y un globo que se cierra solo.
 *
 * ─── NO ES UN MODAL, Y LA DIFERENCIA IMPORTA ────────────────────────────────
 * No atrapa el foco (`useFocusTrap` es para las hojas) ni bloquea el scroll.
 * Un globo de emojis que atrapa el foco obliga a cerrarlo para volver al
 * campo, y lo normal es ir y venir: poner uno, escribir, poner otro. Lo que sí
 * tiene son las tres salidas que cualquiera espera —Escape, tocar afuera,
 * tocar el botón otra vez— y el foco vuelve al botón al cerrar, así que el
 * teclado nunca queda perdido en el medio del documento.
 *
 * ─── ORDEN DEL DOM ──────────────────────────────────────────────────────────
 * El globo se dibuja ARRIBA del botón (`bottom-full`) porque abajo estaría el
 * teclado del teléfono, pero en el DOM va JUSTO DESPUÉS del botón. Es a
 * propósito: tabular desde el botón entra al globo, que es lo que se espera de
 * un desplegable, y `aria-expanded` + `aria-controls` dejan dicha la relación.
 */
export function EmojiPickerPopover({
  onPickCommunity,
  onPickUnicode,
  unicodeGroups,
  disabled = false,
  tone = "surface",
  className,
}: {
  onPickCommunity: (emoji: CommunityEmoji) => void;
  onPickUnicode?: (emoji: string) => void;
  unicodeGroups?: readonly UnicodeEmojiGroup[];
  disabled?: boolean;
  /** "media" = apoyado sobre el vidrio de un video (ver comment-composer). */
  tone?: "surface" | "media";
  className?: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { state, load, retry } = useCommunityEmojis();
  const onMedia = tone === "media";

  const close = useCallback((devolverFoco: boolean) => {
    setOpen(false);
    if (devolverFoco) toggleRef.current?.focus();
  }, []);

  // Escape y toque afuera. `pointerdown` y no `click`: en un teléfono, tocar
  // afuera tiene que cerrar en el momento en que el dedo baja, no cuando se
  // levanta — si no, el mismo toque además activa lo que haya debajo.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close(true);
    }
    function onPointerDown(event: PointerEvent) {
      const node = rootRef.current;
      if (node && !node.contains(event.target as Node)) close(false);
    }

    // `capture` en Escape: este globo puede vivir dentro de una hoja que
    // también cierra con Escape (la de comentarios). Sin capturar primero, un
    // solo Escape cerraría las dos y la persona perdería el hilo entero por
    // querer cerrar un desplegable.
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  // Al abrir, el foco entra al globo. Sin esto, quien navega con teclado abre
  // el panel y sigue parado en el botón: el contenido aparece "en otro lado".
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  function toggle() {
    if (open) {
      close(true);
      return;
    }
    // El catálogo se pide desde el GESTO, no desde un efecto que reacciona a
    // que se abrió: arranca un render antes y no encadena renders.
    load();
    setOpen(true);
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={toggleRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={open ? EMOJI_COPY.closeAria : EMOJI_COPY.openAria}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        className={cn(
          "flex size-11 shrink-0 select-none items-center justify-center rounded-full",
          "transition-[transform,background-color,opacity,color] duration-(--duration-fast) ease-(--ease-spring)",
          "active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100",
          "disabled:pointer-events-none disabled:opacity-45",
          "focus-visible:outline-none focus-visible:ring-[3px]",
          onMedia
            ? "text-on-media/80 hover:text-on-media focus-visible:ring-on-media/70"
            : "text-foreground-muted hover:bg-surface-hover hover:text-foreground focus-visible:ring-focus-ring",
          open && (onMedia ? "text-on-media" : "text-brand"),
        )}
      >
        <Smiley size={22} weight={open ? "fill" : "regular"} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={EMOJI_COPY.panelLabel}
          tabIndex={-1}
          className={cn(
            // Anclado a la IZQUIERDA del botón y no centrado: el botón vive
            // pegado al borde de la píldora, y un globo centrado se saldría de
            // la pantalla en 375 px.
            "absolute bottom-full left-0 z-30 mb-2 w-[min(20rem,calc(100vw-2rem))]",
            "rounded-2xl border border-border bg-surface-raised p-3 shadow-lg",
            "focus-visible:outline-none",
          )}
        >
          <EmojiPicker
            community={state}
            onRetry={retry}
            onPickCommunity={onPickCommunity}
            onPickUnicode={onPickUnicode}
            unicodeGroups={unicodeGroups}
            scrollable
          />
        </div>
      )}
    </div>
  );
}
