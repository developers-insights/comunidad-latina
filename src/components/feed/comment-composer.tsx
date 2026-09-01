"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneRight } from "@phosphor-icons/react/dist/ssr";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import { EmojiPickerPopover } from "@/components/emojis";
import { Spinner, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CLASSIC_EMOJI_GROUPS, emojiShortcode } from "@/lib/emojis/catalog";
import { TENANT_GUARD_COPY } from "@/lib/tenant/match";
import { createCommentAction } from "@/app/(app)/feed/actions";
import { createListingCommentAction } from "@/app/(app)/marketplace/comments-actions";
import { COPY } from "./copy";

const MAX_LENGTH = 1000;

/**
 * Ciclo de vida del envío en modo OPTIMISTA (hoja de comentarios del feed): el
 * composer avisa al contenedor para que pinte el comentario al instante y luego
 * lo reconcilie con el resultado de moderación. Sin esto, el composer se comporta
 * como en el detalle: publica y hace `router.refresh()`.
 */
export interface CommentOptimisticHandlers {
  /** Se disparó el envío: pintá el comentario ya (con estado "enviando"). */
  onStart: (draft: { tempId: string; body: string }) => void;
  /** El servidor lo aceptó (published): confirmá el optimista. */
  onPublished: (tempId: string) => void;
  /** Rechazo/errores (flagged, tenant, error): sacá el optimista de la lista. */
  onRejected: (tempId: string) => void;
}

interface CommentComposerBaseProps {
  /** Deshabilita el input (p.ej. mientras la hoja carga el hilo o su auth). */
  disabled?: boolean;
  /**
   * Modo optimista. Si viene, el composer NO navega (no saca al usuario del
   * feed — el pedido literal del cliente): reporta el ciclo de vida y deja que
   * el contenedor maneje la lista. Ausente → comportamiento del detalle SSR.
   */
  optimistic?: CommentOptimisticHandlers;
  /**
   * Superficie sobre la que se apoya el campo. "media" es el vidrio de la hoja
   * de comentarios SOBRE UN VIDEO: la píldora clara de siempre taparía el video
   * (feedback cliente 2026-07-27), así que pasa a velo de tinta + texto
   * `on-media`. El botón de enviar conserva el color de marca en las dos: es la
   * acción principal y tiene que verse igual de fuerte.
   */
  tone?: "surface" | "media";
}

/**
 * El sujeto del comentario: un POST del feed o un AVISO del marketplace. Union
 * discriminada para que sea imposible pedir los dos (o ninguno) por accidente.
 */
export type CommentComposerProps = CommentComposerBaseProps &
  (
    | { postId: string; listingId?: undefined }
    | { listingId: string; postId?: undefined }
  );

/** Resultado normalizado de las dos server actions (post / listing). */
type SendOutcome =
  | { ok: true }
  | {
      ok: false;
      code: "unauthenticated" | "tenant-mismatch" | "flagged" | "error";
      message?: string;
    };

/**
 * Composer de comentario — misma moderación que el post (el server action pasa
 * el texto por moderateText antes de publicar). Dos modos: el del detalle SSR
 * (`router.refresh()`) y el optimista de la hoja del feed (ver `optimistic`).
 *
 * Sirve a los dos sujetos con el MISMO markup y el mismo ciclo optimista: el
 * único cambio es a qué server action le habla.
 */
export function CommentComposer(props: CommentComposerProps) {
  const { disabled = false, optimistic, tone = "surface" } = props;
  const onMedia = tone === "media";
  // Sin destructuring del union: ambas variantes declaran las dos claves (una
  // como `undefined`), así el acceso es seguro y el branch de abajo es explícito.
  const postId = props.postId ?? null;
  const listingId = props.listingId ?? null;

  const router = useRouter();
  const requireAuth = useRequireAuth();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // id único por instancia: en el feed pueden coexistir esta hoja global y el
  // composer del detalle — un id fijo rompería la asociación label/textarea.
  const fieldId = useId();

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }

  /* ------------------------------ Emojis -------------------------------- */

  /**
   * Dónde tiene que quedar el cursor DESPUÉS de que React pinte el texto nuevo.
   *
   * Va en un ref y se aplica en un efecto sin dependencias, no con un
   * `setTimeout` ni un `requestAnimationFrame`: el valor del textarea lo escribe
   * React al commitear, y mover el cursor antes de eso lo dejaría en una
   * posición del texto viejo. Un ref y no un estado porque escribir estado
   * dentro de un efecto encadena renders (`react-hooks/set-state-in-effect`).
   */
  const pendingCaret = useRef<number | null>(null);
  useEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    const element = textareaRef.current;
    if (!element) return;
    // El foco vuelve al campo: quien acaba de poner un emoji casi siempre sigue
    // escribiendo, y quedarse parado en el botón del picker obliga a volver a
    // tocar el campo para cada palabra.
    element.focus();
    element.setSelectionRange(caret, caret);
    autosize(element);
  });

  /**
   * Inserta EN EL CURSOR y no al final. Poner un emoji en el medio de una
   * frase es lo normal; agregarlo siempre al final obligaría a cortar y pegar.
   * Si hay texto seleccionado, lo reemplaza — que es lo que hace cualquier
   * campo de texto.
   */
  function insertAtCaret(snippet: string) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`.slice(0, MAX_LENGTH);
    pendingCaret.current = Math.min(start + snippet.length, next.length);
    setValue(next);
  }

  /**
   * Un emoji de la comunidad viaja como CÓDIGO CORTO (`:klk:`) porque el cuerpo
   * del comentario es texto. Se agrega un espacio detrás salvo que ya haya uno:
   * sin él, escribir a continuación pega la palabra al código y queda `:klk:que`
   * — que sigue leyéndose bien, pero se ve como un error de tipeo.
   */
  function insertShortcode(slug: string) {
    const element = textareaRef.current;
    const end = element?.selectionEnd ?? value.length;
    const siguiente = value.charAt(end);
    const sufijo = siguiente === "" || /\s/.test(siguiente) ? "" : " ";
    insertAtCaret(`${emojiShortcode(slug)}${sufijo}`);
  }

  function resetField(focus: boolean) {
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      if (focus) textareaRef.current.focus();
    }
  }

  function haptic() {
    try {
      navigator.vibrate?.(10);
    } catch {
      // sin soporte háptico
    }
  }

  /** Publica contra la action que corresponda y normaliza el resultado. */
  async function publish(body: string): Promise<SendOutcome> {
    if (listingId) {
      const result = await createListingCommentAction({ listingId, body });
      if (result.ok) return { ok: true };
      // "moderation" es el "flagged" del marketplace (mismo aviso cálido) y
      // "invalid" no le dice nada al usuario: cae al error genérico.
      if (result.code === "moderation") return { ok: false, code: "flagged" };
      if (result.code === "invalid") return { ok: false, code: "error" };
      return { ok: false, code: result.code, message: result.message };
    }
    const result = await createCommentAction({ postId: postId ?? "", body });
    if (result.ok) return { ok: true };
    if (result.code === "invalid") return { ok: false, code: "error" };
    if (result.code === "tenant-mismatch") {
      return { ok: false, code: "tenant-mismatch", message: result.message };
    }
    return { ok: false, code: result.code };
  }

  function send() {
    const body = value.trim();
    if (!body || isPending || disabled) return;
    sendBody(body);
  }

  /**
   * Publica UN texto concreto. Separado de `send()` porque el reintento después
   * de entrar tiene que llevar el texto ENCIMA: cuando la hoja de entrada
   * devuelve el control, el closure de `send` sigue viendo el `value` que había
   * en el momento del rechazo (vacío, porque el envío optimista lo limpió).
   */
  function sendBody(body: string) {
    // Optimista: limpiamos el campo YA y avisamos para pintar el comentario en
    // el acto. Si el servidor lo rechaza, devolvemos el texto para reintentar.
    const tempId = optimistic ? crypto.randomUUID() : "";
    if (optimistic) {
      optimistic.onStart({ tempId, body });
      resetField(false);
    }

    startTransition(async () => {
      const result = await publish(body);
      if (result.ok) {
        if (optimistic) {
          optimistic.onPublished(tempId);
        } else {
          resetField(true);
          router.refresh();
        }
        haptic();
        return;
      }

      // Falla: en modo optimista revertimos el pintado y recuperamos el texto.
      if (optimistic) {
        optimistic.onRejected(tempId);
        setValue(body);
      }

      if (result.code === "unauthenticated") {
        // Antes acá había un `router.push('/entrar?next=/feed/[postId]')`: la
        // persona salía del feed Y volvía al DETALLE de la publicación, que es
        // una pantalla donde nunca había estado. Es el reclamo literal del
        // cliente (2026-08-20): "no te tiene que mover a otra publicación; ahí
        // nomás dentro de pantalla se tiene que fluir sin sacarte del feed".
        //
        // Ahora la puerta se abre ENCIMA (la hoja de comentarios sigue abierta
        // detrás, con su scroll intacto) y al entrar se reintenta el mismo
        // texto. `sendBody` y no `send`: ver su docblock.
        requireAuth({
          reason: AUTH_REASON.comment,
          // Este composer es el del detalle SSR: si la persona está ahí es
          // porque abrió el enlace compartido, así que el destino de respaldo
          // es esa misma publicación. Ver `resumeDestination`.
          foldPostDetail: false,
          onAuthenticated: () => sendBody(body),
        });
        return;
      }
      if (result.code === "tenant-mismatch") {
        toast({
          title: TENANT_GUARD_COPY.mismatchTitle,
          description: result.message,
          variant: "warning",
          duration: 8000,
        });
        return;
      }
      if (result.code === "flagged") {
        toast({
          title: COPY.comments.flaggedTitle,
          description: COPY.comments.flaggedBody,
          variant: "warning",
        });
        return;
      }
      toast({
        title: COPY.comments.errorTitle,
        description: COPY.comments.errorBody,
        variant: "danger",
      });
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      className={cn(
        // `rounded-full` y no un radio fijo (era `rounded-2xl`, 32px): con un
        // valor fijo el navegador clampea el BORDE al alto real del pill pero
        // clampea el box-shadow del anillo de foco con la lógica de "radio
        // declarado", y a la altura de este input (62px) ambos números casi
        // coinciden — la costura queda visible en las puntas, sólo con el
        // anillo puesto. `rounded-full` (9999px) no tiene ese punto ambiguo:
        // border y box-shadow clampean igual, en cualquier alto (el campo
        // crece hasta max-h-36 al escribir varias líneas).
        "flex items-end gap-2 rounded-full border p-2 shadow-sm",
        // Sobre el vidrio la píldora se HUNDE (tinta) en vez de aclararse: así
        // el texto y el placeholder quedan AA aun con un video blanco detrás.
        onMedia
          ? "border-on-media/25 bg-media-shade/35 shadow-none"
          : "border-border bg-surface-raised",
        // El anillo de foco vive en el FORM, no en el textarea: así sigue la
        // píldora en vez de dibujar un rectángulo que no empalma con la card
        // (el textarea apaga su outline, y sin esto no quedaba NINGÚN indicador
        // visible de foco — el navegador ponía el suyo, cuadrado).
        "transition-shadow duration-(--duration-fast)",
        onMedia
          ? "focus-within:ring-[3px] focus-within:ring-on-media/70"
          : "focus-within:ring-[3px] focus-within:ring-focus-ring",
      )}
    >
      {/* ── EMOJIS ──────────────────────────────────────────────────────────
          A la IZQUIERDA del campo, como en cualquier app de mensajes: el lado
          derecho es de "enviar", y una carita pegada al botón de enviar se toca
          por error con el pulgar. El globo se abre hacia arriba (el teclado
          ocupa lo de abajo) y anclado a este borde, así entra entero en 375 px.

          EMOJIS PROPIOS EN COMENTARIOS: el picker deja un `:slug:` en el texto
          y quien PINTA el comentario lo cambia por la imagen — `comment-item.tsx`
          envuelve `{body}` en `<CommunityEmojiText>`. El circuito está cerrado de
          punta a punta, así que encender `community_emojis.is_active` (la 0125 lo
          deja en false) ya no deja ningún ":klk:" a la vista. Si alguna vez se
          quita ese renderer, hay que apagar el catálogo en el mismo movimiento. */}
      <EmojiPickerPopover
        tone={tone}
        disabled={isPending || disabled}
        unicodeGroups={CLASSIC_EMOJI_GROUPS}
        onPickUnicode={insertAtCaret}
        onPickCommunity={(emoji) => insertShortcode(emoji.slug)}
      />

      <label htmlFor={fieldId} className="sr-only">
        {COPY.comments.placeholder}
      </label>
      <textarea
        id={fieldId}
        ref={textareaRef}
        rows={1}
        maxLength={MAX_LENGTH}
        value={value}
        placeholder={COPY.comments.placeholder}
        disabled={isPending || disabled}
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
          "max-h-36 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm",
          onMedia
            ? "text-on-media placeholder:text-on-media/70"
            : "text-foreground placeholder:text-foreground-muted",
          "focus:outline-none focus-visible:outline-none",
          "disabled:opacity-60",
        )}
      />
      <button
        type="submit"
        aria-label={COPY.comments.send}
        disabled={isPending || disabled || value.trim().length === 0}
        className={cn(
          "flex size-11 shrink-0 select-none items-center justify-center rounded-full bg-brand text-brand-foreground shadow-xs",
          "transition-[transform,background-color,opacity] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-brand-hover active:scale-[0.94]",
          "disabled:pointer-events-none disabled:opacity-45",
          "focus-visible:outline-none focus-visible:ring-[3px]",
          onMedia ? "focus-visible:ring-on-media/70" : "focus-visible:ring-focus-ring",
        )}
      >
        {isPending ? (
          <Spinner size={18} />
        ) : (
          <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}
