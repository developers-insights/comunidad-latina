"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneRight, Plus } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { EmojiPickerPopover } from "@/components/emojis";
import { CLASSIC_EMOJI_GROUPS, emojiShortcode } from "@/lib/emojis/catalog";
import { enviarMensajeAlGrupoAction } from "@/app/(app)/mensajes/grupos/actions";
import { LIMITES } from "@/lib/messaging/grupos";
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

/**
 * Composer del chat de grupo.
 *
 * Es el gemelo de `composer.tsx` (chat 1-a-1) y se copia en vez de compartirse
 * a propósito: la diferencia no es sólo la action —cambian el placeholder, el
 * copy de error y el caso "el grupo se cerró mientras escribías", que en un
 * directo no existe—. Un componente con un `if (esGrupo)` en cada rama sería
 * más largo que los dos juntos y más difícil de tocar sin romper el otro.
 *
 * Lo que SÍ se comparte es el orquestador de adjuntos (`useAdjuntos` en
 * `attach-menu.tsx`): ahí la lógica es idéntica y son ciento cincuenta líneas
 * con subidas y archivos huérfanos de por medio, no cuarenta de textarea.
 */
export function GroupComposer({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [valor, setValor] = useState("");
  const [enviando, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const caretPendiente = useRef<number | null>(null);

  const [menuAbierto, setMenuAbierto] = useState(false);
  const [hoja, setHoja] = useState<null | "galeria" | "camara" | "enlace" | "ubicacion">(null);
  const [grabando, setGrabando] = useState(false);

  const destino = useMemo(() => ({ tipo: "grupo" as const, groupId }), [groupId]);
  const { cola, enviarArchivos, enviarAudio, enviarSinArchivo, procesar, descartar } =
    useAdjuntos(destino);

  /** `null` fuera del `ResponderProvider`, que monta la página del grupo. */
  const responder = useResponder();

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
  }, [valor]);

  function autosize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }

  function insertarEnCaret(fragmento: string) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? valor.length;
    const end = element?.selectionEnd ?? start;
    const siguiente = `${valor.slice(0, start)}${fragmento}${valor.slice(end)}`.slice(
      0,
      LIMITES.mensajeMax,
    );
    caretPendiente.current = Math.min(start + fragmento.length, siguiente.length);
    setValor(siguiente);
    element?.focus();
  }

  function insertarCodigoCorto(slug: string) {
    const element = textareaRef.current;
    const end = element?.selectionEnd ?? valor.length;
    const siguiente = valor.charAt(end);
    const sufijo = siguiente === "" || /\s/.test(siguiente) ? "" : " ";
    insertarEnCaret(`${emojiShortcode(slug)}${sufijo}`);
  }

  function elegirDelMenu(opcion: OpcionDeAdjunto) {
    if (opcion === "galeria" || opcion === "camara" || opcion === "enlace" || opcion === "ubicacion") {
      setHoja(opcion);
      return;
    }
    if (opcion === "archivo") {
      archivoRef.current?.click();
      return;
    }
    void enviarSinArchivo({ tipo: "perfil" });
  }

  function enviar() {
    const body = valor.trim();
    if (!body || enviando) return;

    const replyTo = responder?.citado?.id ?? null;

    startTransition(async () => {
      const resultado = await enviarMensajeAlGrupoAction({ groupId, body, replyTo });

      if (resultado.ok) {
        setValor("");
        responder?.cancelar();
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.focus();
        }
        // Confirmación háptica sutil (§5.1) — sólo si el dispositivo la soporta.
        try {
          navigator.vibrate?.(10);
        } catch {
          // sin soporte: nada que hacer
        }
        router.refresh();
        return;
      }

      if (resultado.code === "flagged") {
        toast({
          title: COPY.composer.flaggedTitle,
          description: COPY.composer.flaggedBody,
          variant: "warning",
        });
        return;
      }
      if (resultado.code === "rate-limited") {
        toast({
          title: COPY.composer.rateLimitedTitle,
          description: COPY.groups.rateLimited,
          variant: "warning",
        });
        return;
      }
      if (resultado.code === "forbidden") {
        // Te sacaron del grupo o lo cerraron mientras tenías la pantalla
        // abierta. Se refresca para que la pantalla deje de mentir en vez de
        // dejar el composer ahí, listo para fallar otra vez.
        toast({ title: COPY.groups.closedBanner, variant: "warning" });
        router.refresh();
        return;
      }
      toast({
        title: COPY.composer.errorTitle,
        description: COPY.composer.errorBody,
        variant: "danger",
      });
    });
  }

  const hayTexto = valor.trim().length > 0;

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
          enviar();
        }}
        className="flex items-end gap-1 rounded-2xl border border-border bg-surface-raised p-2 shadow-sm"
      >
        {!grabando && (
          <>
            <button
              type="button"
              onClick={() => setMenuAbierto(true)}
              disabled={enviando}
              aria-label={COPY_COMPOSER.adjuntar.abrir}
              aria-haspopup="dialog"
              aria-expanded={menuAbierto}
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-muted cl-print-hide",
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
              disabled={enviando}
              unicodeGroups={CLASSIC_EMOJI_GROUPS}
              onPickUnicode={insertarEnCaret}
              onPickCommunity={(emoji) => insertarCodigoCorto(emoji.slug)}
              className="cl-print-hide"
            />

            <label htmlFor="group-composer-body" className="sr-only">
              {COPY.groups.composerPlaceholder}
            </label>
            <textarea
              id="group-composer-body"
              ref={textareaRef}
              data-composer-input
              rows={1}
              maxLength={LIMITES.mensajeMax}
              value={valor}
              placeholder={COPY.groups.composerPlaceholder}
              disabled={enviando}
              onChange={(event) => {
                setValor(event.target.value);
                autosize(event.target);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  enviar();
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

        {(!hayTexto || grabando) && (
          <VoiceRecorder
            disabled={enviando}
            onActivo={setGrabando}
            onListo={(grabacion) => void enviarAudio(grabacion)}
          />
        )}

        {hayTexto && !grabando && (
          <button
            type="submit"
            aria-label={COPY.composer.send}
            disabled={enviando}
            className={cn(
              "flex size-11 shrink-0 select-none items-center justify-center rounded-full bg-brand text-brand-foreground shadow-xs cl-print-hide",
              "transition-[transform,background-color,opacity] duration-(--duration-fast) ease-(--ease-spring)",
              "hover:bg-brand-hover active:scale-[0.94]",
              "disabled:pointer-events-none disabled:opacity-45",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              "motion-reduce:transition-none motion-reduce:active:scale-100",
            )}
          >
            {enviando ? (
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
        chatId={groupId}
        onClose={() => setHoja(null)}
        onEnviar={(archivos, pie) => void enviarArchivos(archivos, pie)}
      />
      <EnlaceSheet
        open={hoja === "enlace"}
        onClose={() => setHoja(null)}
        onListo={(url) => insertarEnCaret(valor.length > 0 ? ` ${url}` : url)}
      />
      <LocationPicker
        open={hoja === "ubicacion"}
        onClose={() => setHoja(null)}
        onEnviar={(punto) => void enviarSinArchivo({ tipo: "ubicacion", ...punto })}
      />
    </div>
  );
}
