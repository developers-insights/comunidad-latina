"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneRight, Plus } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { EmojiPickerPopover } from "@/components/emojis";
import { CLASSIC_EMOJI_GROUPS, emojiShortcode } from "@/lib/emojis/catalog";
import { sendMessageAction } from "@/app/(app)/mensajes/actions";
import { COPY } from "./copy";
import { COPY_COMPOSER } from "./copy-composer";
import {
  AttachMenu,
  ColaDeAdjuntos,
  EnlaceSheet,
  useAdjuntos,
  type OpcionDeAdjunto,
} from "./attach-menu";
import { ComposerReplyBar, useResponder } from "./reply-quote";
import { PhotoPicker } from "./photo-picker";
import { LocationPicker } from "./location-picker";
import { VoiceRecorder } from "./voice-recorder";

const MAX_LENGTH = 2000;

/**
 * LA BARRA DE MENSAJE del chat 1-a-1.
 *
 * De izquierda a derecha: `+` (adjuntar), emojis, el campo, y —según haya texto
 * escrito o no— el micrófono o el botón de enviar. Ese último cambio es el que
 * hace que la barra no crezca: el micrófono y el avión nunca conviven, porque
 * nunca sirven al mismo tiempo.
 *
 * Enter envía y Shift+Enter salta de línea, como antes.
 */
export function Composer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const caretPendiente = useRef<number | null>(null);

  const [menuAbierto, setMenuAbierto] = useState(false);
  const [hoja, setHoja] = useState<null | "galeria" | "camara" | "enlace" | "ubicacion">(null);
  const [grabando, setGrabando] = useState(false);

  const destino = useMemo(
    () => ({ tipo: "directo" as const, conversationId }),
    [conversationId],
  );
  const { cola, enviarArchivos, enviarAudio, enviarSinArchivo, procesar, descartar } =
    useAdjuntos(destino);

  /**
   * Fuera del `ResponderProvider` esto es `null` y el composer se comporta
   * como siempre: la página del hilo es la que lo monta.
   */
  const responder = useResponder();

  /**
   * Devolver el cursor DESPUÉS de insertar un emoji o un enlace. Va en un
   * efecto y no en el callback del `ref` porque el ref sólo corre al montar y
   * desmontar: el nodo es el mismo antes y después de la inserción.
   */
  useEffect(() => {
    const posicion = caretPendiente.current;
    if (posicion === null) return;
    caretPendiente.current = null;
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(posicion, posicion);
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [value]);

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }

  function insertarEnCaret(fragmento: string) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    const siguiente = `${value.slice(0, start)}${fragmento}${value.slice(end)}`.slice(
      0,
      MAX_LENGTH,
    );
    caretPendiente.current = Math.min(start + fragmento.length, siguiente.length);
    setValue(siguiente);
    element?.focus();
  }

  function insertarCodigoCorto(slug: string) {
    const element = textareaRef.current;
    const end = element?.selectionEnd ?? value.length;
    const siguiente = value.charAt(end);
    const sufijo = siguiente === "" || /\s/.test(siguiente) ? "" : " ";
    insertarEnCaret(`${emojiShortcode(slug)}${sufijo}`);
  }

  function elegirDelMenu(opcion: OpcionDeAdjunto) {
    if (opcion === "galeria" || opcion === "camara") {
      setHoja(opcion);
      return;
    }
    if (opcion === "archivo") {
      archivoRef.current?.click();
      return;
    }
    if (opcion === "enlace" || opcion === "ubicacion") {
      setHoja(opcion);
      return;
    }
    void enviarSinArchivo({ tipo: "perfil" });
  }

  function send() {
    const body = value.trim();
    if (!body || isPending) return;

    const replyTo = responder?.citado?.id ?? null;

    startTransition(async () => {
      const result = await sendMessageAction({ conversationId, body, replyTo });
      if (result.ok) {
        setValue("");
        responder?.cancelar();
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.focus();
        }
        // Confirmación háptica sutil (§5.1) — solo si el dispositivo la soporta.
        try {
          navigator.vibrate?.(10);
        } catch {
          // sin soporte: nada que hacer
        }
        router.refresh();
      } else if (result.code === "flagged") {
        toast({
          title: COPY.composer.flaggedTitle,
          description: COPY.composer.flaggedBody,
          variant: "warning",
        });
      } else if (result.code === "rate-limited") {
        toast({
          title: COPY.composer.rateLimitedTitle,
          description: COPY.composer.rateLimitedBody,
          variant: "warning",
        });
      } else {
        toast({
          title: COPY.composer.errorTitle,
          description: COPY.composer.errorBody,
          variant: "danger",
        });
      }
    });
  }

  const hayTexto = value.trim().length > 0;

  return (
    <div>
      <ColaDeAdjuntos cola={cola} onReintentar={procesar} onDescartar={descartar} />

      <ComposerReplyBar />

      <input
        ref={archivoRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(event) => {
          const archivos = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (archivos.length > 0) void enviarArchivos(archivos, "");
        }}
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="flex items-end gap-1 rounded-2xl border border-border bg-surface-raised p-2 shadow-sm"
      >
        {!grabando && (
          <>
            <button
              type="button"
              onClick={() => setMenuAbierto(true)}
              disabled={isPending}
              aria-label={COPY_COMPOSER.adjuntar.abrir}
              aria-haspopup="dialog"
              aria-expanded={menuAbierto}
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-muted",
                "transition-[transform,background-color,color] duration-(--duration-fast) ease-(--ease-spring)",
                "hover:bg-surface-hover hover:text-foreground active:scale-[0.9]",
                "disabled:pointer-events-none disabled:opacity-45",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                "motion-reduce:transition-none motion-reduce:active:scale-100",
                menuAbierto && "rotate-45 text-brand",
              )}
            >
              <Plus size={22} aria-hidden="true" />
            </button>

            <EmojiPickerPopover
              disabled={isPending}
              unicodeGroups={CLASSIC_EMOJI_GROUPS}
              onPickUnicode={insertarEnCaret}
              onPickCommunity={(emoji) => insertarCodigoCorto(emoji.slug)}
            />

            <label htmlFor="composer-body" className="sr-only">
              {COPY.composer.placeholder}
            </label>
            <textarea
              id="composer-body"
              ref={textareaRef}
              data-composer-input
              rows={1}
              maxLength={MAX_LENGTH}
              value={value}
              placeholder={COPY.composer.placeholder}
              disabled={isPending}
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
                "max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-foreground",
                "placeholder:text-foreground-muted focus:outline-none",
                "disabled:opacity-60",
              )}
            />
          </>
        )}

        {/* El micrófono ocupa la barra entera mientras graba (`onActivo`), así
            que se monta SIEMPRE: desmontarlo cortaría la grabación en curso. */}
        {(!hayTexto || grabando) && (
          <VoiceRecorder
            disabled={isPending}
            onActivo={setGrabando}
            onListo={(grabacion) => void enviarAudio(grabacion)}
          />
        )}

        {hayTexto && !grabando && (
          <button
            type="submit"
            aria-label={COPY.composer.send}
            disabled={isPending}
            className={cn(
              "flex size-11 shrink-0 select-none items-center justify-center rounded-full bg-brand text-brand-foreground shadow-xs",
              "transition-[transform,background-color,opacity] duration-(--duration-fast) ease-(--ease-spring)",
              "hover:bg-brand-hover active:scale-[0.94]",
              "disabled:pointer-events-none disabled:opacity-45",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "motion-reduce:transition-none motion-reduce:active:scale-100",
            )}
          >
            {isPending ? (
              <Spinner size={18} />
            ) : (
              <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
            )}
          </button>
        )}
      </form>

      <AttachMenu
        open={menuAbierto}
        onClose={() => setMenuAbierto(false)}
        onElegir={elegirDelMenu}
      />
      <PhotoPicker
        open={hoja === "galeria" || hoja === "camara"}
        modoCamara={hoja === "camara"}
        chatId={conversationId}
        onClose={() => setHoja(null)}
        onEnviar={(archivos, pie) => void enviarArchivos(archivos, pie)}
      />
      <EnlaceSheet
        open={hoja === "enlace"}
        onClose={() => setHoja(null)}
        onListo={(url) => insertarEnCaret(value.length > 0 ? ` ${url}` : url)}
      />
      <LocationPicker
        open={hoja === "ubicacion"}
        onClose={() => setHoja(null)}
        onEnviar={(punto) => void enviarSinArchivo({ tipo: "ubicacion", ...punto })}
      />
    </div>
  );
}
