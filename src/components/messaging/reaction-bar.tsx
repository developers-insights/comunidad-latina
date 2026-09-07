"use client";

import { useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { EmojiPicker } from "@/components/emojis";
import { useCommunityEmojis } from "@/lib/emojis/use-community-emojis";
import {
  CLASSIC_EMOJI_GROUPS,
  emojiShortcode,
  type CommunityEmoji,
} from "@/lib/emojis/catalog";
import { REACCIONES_RAPIDAS } from "@/lib/messaging/reacciones";
import { useReaccionesDelMensaje, EmojiDeReaccion, useEmojisDeComunidad } from "./message-reactions";
import { ACCIONES_COPY } from "./copy-acciones";

/**
 * =============================================================================
 * LA FILA DE REACCIONES RÁPIDAS
 * =============================================================================
 *
 * Las seis de la lámina del cliente, y un botón que abre el catálogo COMPLETO
 * de emojis de la comunidad — que es el pedido textual: «poder reaccionar a los
 * msjs con los stickers que ya tenemos implementados en la plataforma».
 *
 * ─── SE REUSA EL PICKER QUE YA EXISTE ───────────────────────────────────────
 * `EmojiPicker` (0125) es el mismo que usan el comentario y el editor de fotos,
 * con su buscador, sus pestañas y su estado de error. Escribir otro habría
 * significado que el día que la comunidad suma un dibujo, aparece en dos
 * pantallas y en la tercera no.
 *
 * ─── LA ENTRADA ES FÍSICA, NO UN FUNDIDO ────────────────────────────────────
 * Los seis emojis entran escalonados desde el lado de la burbuja: la fila crece
 * desde donde estaba el dedo, que es lo que la hace sentir "salida del mensaje"
 * y no "aparecida en la pantalla". 26 ms entre uno y otro — el total queda en
 * ~160 ms, bien debajo del techo de 300 ms de una interacción frecuente.
 * Con `prefers-reduced-motion` se apaga el movimiento y queda la opacidad.
 */
export function ReactionBar({
  isOwn,
  onElegido,
  className,
}: {
  /** De qué lado está la burbuja: la fila crece desde ahí. */
  isOwn: boolean;
  /** Se llama después de elegir, para que el menú se cierre solo. */
  onElegido?: () => void;
  className?: string;
}) {
  const estado = useReaccionesDelMensaje();
  const reduceMotion = useReducedMotion();
  const [abriendoCatalogo, setAbriendoCatalogo] = useState(false);
  const { state, load, retry } = useCommunityEmojis();

  // Las rápidas son unicode, así que el catálogo sólo hace falta si YA hay una
  // reacción de la comunidad puesta (para pintarla resaltada en la fila).
  const kindsPuestos = new Set((estado?.reacciones ?? []).map((r) => r.kind));
  const catalogo = useEmojisDeComunidad(
    abriendoCatalogo || [...kindsPuestos].some((kind) => kind.startsWith(":")),
  );

  if (!estado) return null;

  function elegir(kind: string) {
    estado?.alternar(kind);
    onElegido?.();
  }

  function abrirCatalogo() {
    // El catálogo se pide desde el GESTO y no desde un efecto que reacciona a
    // que se abrió: arranca un render antes y no encadena renders. Mismo
    // criterio que `EmojiPickerPopover`.
    load();
    setAbriendoCatalogo(true);
  }

  if (abriendoCatalogo) {
    return (
      <div
        className={cn(
          "w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface-raised p-3 shadow-lg",
          className,
        )}
      >
        <EmojiPicker
          community={state}
          onRetry={retry}
          scrollable
          unicodeGroups={CLASSIC_EMOJI_GROUPS}
          onPickCommunity={(emoji: CommunityEmoji) => elegir(emojiShortcode(emoji.slug))}
          onPickUnicode={(emoji: string) => elegir(emoji)}
          labelForCommunity={(label, alt) =>
            ACCIONES_COPY.reacciones.poner(`${label}: ${alt}`)
          }
          labelForUnicode={(emoji) => ACCIONES_COPY.reacciones.poner(emoji)}
        />
      </div>
    );
  }

  const rapidas: readonly string[] = REACCIONES_RAPIDAS;
  // Si ya tengo puesto un emoji que no está entre las seis, se suma adelante:
  // sin esto, sacar mi propia reacción exigiría abrir el catálogo a buscarla.
  const propiaFueraDeLista =
    estado.mia !== null && !rapidas.includes(estado.mia) ? estado.mia : null;
  const fila = propiaFueraDeLista ? [propiaFueraDeLista, ...rapidas] : [...rapidas];

  return (
    <m.div
      role="group"
      aria-label={ACCIONES_COPY.reacciones.barLabel}
      className={cn(
        "flex items-center gap-0.5 rounded-full border border-border-subtle bg-surface-raised p-1 shadow-lg",
        className,
      )}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.86 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      style={{ transformOrigin: isOwn ? "bottom right" : "bottom left" }}
      transition={{ type: "spring", stiffness: 480, damping: 30, mass: 0.7 }}
    >
      {fila.map((kind, indice) => {
        const mia = estado.mia === kind;
        return (
          <m.button
            key={kind}
            type="button"
            onClick={() => elegir(kind)}
            aria-pressed={mia}
            aria-label={
              mia
                ? ACCIONES_COPY.reacciones.quitar(kind)
                : ACCIONES_COPY.reacciones.poner(kind)
            }
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.4, y: 6 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            transition={
              reduceMotion
                ? { duration: 0.12 }
                : {
                    type: "spring",
                    stiffness: 560,
                    damping: 24,
                    mass: 0.5,
                    delay: indice * 0.026,
                  }
            }
            className={cn(
              // 44px de blanco táctil (WCAG 2.5.8) con el dibujo chico adentro.
              "flex size-11 shrink-0 items-center justify-center rounded-full",
              "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
              "hover:bg-surface-hover active:scale-[0.88]",
              "motion-reduce:transition-none motion-reduce:active:scale-100",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              mia && "bg-brand-tint ring-1 ring-brand/40",
            )}
          >
            <EmojiDeReaccion kind={kind} catalogo={catalogo} lado={24} />
          </m.button>
        );
      })}

      <m.button
        type="button"
        onClick={abrirCatalogo}
        aria-label={ACCIONES_COPY.reacciones.verTodos}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.4, y: 6 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        transition={
          reduceMotion
            ? { duration: 0.12 }
            : {
                type: "spring",
                stiffness: 560,
                damping: 24,
                mass: 0.5,
                delay: fila.length * 0.026,
              }
        }
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          "border border-dashed border-border text-foreground-muted",
          "transition-[transform,background-color,color] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-surface-hover hover:text-foreground active:scale-[0.88]",
          "motion-reduce:transition-none motion-reduce:active:scale-100",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <Plus size={18} weight="bold" aria-hidden="true" />
      </m.button>
    </m.div>
  );
}
