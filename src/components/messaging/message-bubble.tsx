import { Prohibit } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import type { ReaccionAgrupada } from "@/lib/messaging/reacciones";
import { ACCIONES_COPY } from "./copy-acciones";
import { MessageActions } from "./message-menu";
import { MessageReactions, ReaccionesProvider } from "./message-reactions";
import { ReplyQuote, anclaDeMensaje, type MensajeCitado } from "./reply-quote";

/**
 * Burbuja de mensaje del chat de dos: propias a la derecha con marca suave,
 * ajenas a la izquierda sobre superficie neutra (§4 wireframes).
 * El body es SIEMPRE texto plano (React lo escapa) — nunca HTML.
 *
 * ─── SIGUE SIENDO UN COMPONENTE DE SERVIDOR ─────────────────────────────────
 * Lo interactivo (el menú, las reacciones, el toque largo) son ISLAS que
 * reciben esta burbuja como `children`: el texto, la hora y la cita se pintan
 * en el servidor y viajan ya renderizados. Sin eso, agregar un menú por mensaje
 * habría arrastrado el hilo entero al navegador — doscientos mensajes de
 * JavaScript para tres botones.
 *
 * ─── `acciones` ES LO QUE ENCIENDE TODO ─────────────────────────────────────
 * Sin ese prop la burbuja se comporta EXACTAMENTE como antes: server puro, sin
 * un solo handler. Es lo que deja que la página se actualice en un paso y no en
 * una migración: mientras no lo pase, nada cambia.
 */
export interface MessageBubbleAcciones {
  mensajeId: string;
  /** `conversation_id`: lo necesitan las actions para revalidar el hilo. */
  hiloId: string;
  /** ISO — la ventana de edición de 15 minutos se mide contra esto. */
  createdAt: string;
  /** `messages.kind`. Por omisión, texto. */
  kind?: string;
  /** Cómo se llama quien lo escribió (para la cita de una respuesta). */
  autorNombre: string;
  /** Cómo me llamo yo, para el "quién reaccionó" optimista. */
  nombrePropio: string;
  reacciones?: readonly ReaccionAgrupada[];
  /** Si el mensaje ES una tarjeta compartida, se puede reenviar. */
  compartido?: { kind: string; id: string; titulo: string; url: string } | null;
}

export function MessageBubble({
  body,
  isOwn,
  timeLabel,
  acciones,
  editadoAt = null,
  deletedAt = null,
  respuesta = null,
}: {
  body: string;
  isOwn: boolean;
  timeLabel: string;
  acciones?: MessageBubbleAcciones;
  editadoAt?: string | null;
  /** Un mensaje bajado deja lápida: no desaparece dejando un hueco. */
  deletedAt?: string | null;
  respuesta?: MensajeCitado | null;
}) {
  if (deletedAt) {
    return (
      <MensajeBajado
        isOwn={isOwn}
        timeLabel={timeLabel}
        ancla={acciones ? anclaDeMensaje(acciones.mensajeId) : undefined}
      />
    );
  }

  const burbuja = (
    <div
      id={acciones ? anclaDeMensaje(acciones.mensajeId) : undefined}
      className={cn(
        "max-w-[80%] rounded-2xl px-4 py-2.5",
        // El destaque de "ir al mensaje original" (ver `irAlMensaje`): aparece y
        // se va solo. Instantáneo a propósito — lo que se anima es un latido de
        // escala, que es transform y no repinta la conversación.
        "data-[destacado=true]:ring-2 data-[destacado=true]:ring-brand/60",
        isOwn
          ? "rounded-br-md bg-brand-tint text-foreground"
          : "rounded-bl-md bg-surface-subtle text-foreground",
      )}
    >
      {respuesta && <ReplyQuote citado={respuesta} isOwn={isOwn} />}

      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{body}</p>

      {/* `foreground-secondary`, no `-muted`: las dos burbujas se pintan sobre
          superficies tintadas (brand-tint / surface-subtle) y ahí `-muted` da
          4.35–4.41:1 en light. A 10px eso es texto normal (AA 4.5:1). */}
      <p
        className={cn(
          "mt-1 flex items-center gap-1 text-[10px] text-foreground-secondary",
          isOwn ? "justify-end" : "justify-start",
        )}
      >
        {editadoAt && (
          <>
            <span title={ACCIONES_COPY.editar.marcaAria}>{ACCIONES_COPY.editar.marca}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        {timeLabel}
      </p>
    </div>
  );

  if (!acciones) {
    return (
      <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>{burbuja}</div>
    );
  }

  return (
    <ReaccionesProvider
      ambito="directo"
      mensajeId={acciones.mensajeId}
      hiloId={acciones.hiloId}
      nombrePropio={acciones.nombrePropio}
      iniciales={acciones.reacciones ?? []}
    >
      <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
        <MessageActions
          ambito="directo"
          mensajeId={acciones.mensajeId}
          hiloId={acciones.hiloId}
          isOwn={isOwn}
          kind={acciones.kind}
          createdAt={acciones.createdAt}
          body={body}
          autorNombre={acciones.autorNombre}
          compartido={acciones.compartido ?? null}
        >
          {burbuja}
        </MessageActions>
      </div>
      <MessageReactions isOwn={isOwn} />
    </ReaccionesProvider>
  );
}

/**
 * LA LÁPIDA.
 *
 * Un mensaje bajado no se saca del hilo: deja su lugar. Si desapareciera, la
 * conversación quedaría con un salto y la respuesta de al lado sin a qué
 * responder — y quien no vio el original no entendería nada de lo que sigue.
 */
function MensajeBajado({
  isOwn,
  timeLabel,
  ancla,
}: {
  isOwn: boolean;
  timeLabel: string;
  ancla?: string;
}) {
  return (
    <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
      <div
        id={ancla}
        className={cn(
          "flex max-w-[80%] items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-2",
          "data-[destacado=true]:ring-2 data-[destacado=true]:ring-brand/60",
          isOwn ? "rounded-br-md" : "rounded-bl-md",
        )}
      >
        <Prohibit size={14} aria-hidden="true" className="shrink-0 text-foreground-muted" />
        <span className="text-xs italic text-foreground-muted">
          {isOwn ? ACCIONES_COPY.eliminar.lapidaPropia : ACCIONES_COPY.eliminar.lapida}
        </span>
        <span className="text-[10px] text-foreground-muted">{timeLabel}</span>
      </div>
    </div>
  );
}
