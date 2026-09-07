import type { ReactNode } from "react";
import { Prohibit } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui";
import type { ReaccionAgrupada } from "@/lib/messaging/reacciones";
import { ACCIONES_COPY } from "./copy-acciones";
import { MessageActions } from "./message-menu";
import { MessageReactions, ReaccionesProvider } from "./message-reactions";
import { ReplyQuote, type MensajeCitado } from "./reply-quote";
import { anclaDeMensaje } from "./helpers-de-mensaje";

/**
 * Burbuja de un mensaje de GRUPO.
 *
 * La diferencia con `message-bubble.tsx` es la única que importa en un grupo:
 * QUIÉN LO DIJO. Sin nombre ni cara, veinte personas se leen como una sola voz
 * y la conversación deja de tener sentido a los tres mensajes.
 *
 * ── AGRUPAR MENSAJES SEGUIDOS ───────────────────────────────────────────────
 * El nombre y el avatar aparecen sólo en el PRIMER mensaje de una tanda de la
 * misma persona (`mostrarAutor`). Repetirlos en cada burbuja convierte una
 * respuesta de tres líneas en tres tarjetas con la misma foto, que es ruido y
 * además empuja el resto de la conversación fuera de pantalla. Es lo que hacen
 * todos los chats y es lo que la gente espera sin poder nombrarlo.
 *
 * El hueco del avatar se reserva igual en las burbujas que no lo muestran
 * (`size-8` vacío) para que la columna del texto no baile de a 40px.
 *
 * ── UNA SOLA FORMA DE MONTAR EL MENÚ ────────────────────────────────────────
 * `mensaje` es el camino completo y el único: envuelve la burbuja para que el
 * TOQUE LARGO abra el menú, y enciende reacciones, cita de respuesta y lápida.
 * Antes convivía con un prop `acciones` que recibía el menú ya armado y lo
 * ponía al costado —sin toque largo y sin reacciones—; se eliminó junto con
 * `GroupMessageActions`, que era quien lo llenaba. Dos maneras de abrir el
 * mismo menú, una peor que la otra, sólo garantizaban que alguna pantalla
 * quedara con la peor.
 */
export interface GroupMessageMensaje {
  mensajeId: string;
  /** `group_id`. */
  hiloId: string;
  createdAt: string;
  kind?: string;
  /** Administro el grupo: puedo bajar mensajes ajenos (0133 §6). */
  administro?: boolean;
  /** Cómo me llamo yo, para el "quién reaccionó" optimista. */
  nombrePropio: string;
  reacciones?: readonly ReaccionAgrupada[];
  compartido?: { kind: string; id: string; titulo: string; url: string } | null;
}

export function GroupMessageBubble({
  body,
  isOwn,
  timeLabel,
  autorNombre,
  autorAvatar,
  mostrarAutor,
  mensaje,
  editadoAt = null,
  deletedAt = null,
  respuesta = null,
  media = null,
}: {
  body: string;
  isOwn: boolean;
  timeLabel: string;
  autorNombre: string;
  autorAvatar: string | null;
  mostrarAutor: boolean;
  mensaje: GroupMessageMensaje;
  editadoAt?: string | null;
  deletedAt?: string | null;
  respuesta?: MensajeCitado | null;
  /** Gemelo del `media` de `message-bubble.tsx`, y por el mismo motivo. */
  media?: ReactNode;
}) {
  const ancla = anclaDeMensaje(mensaje.mensajeId);

  if (deletedAt) {
    return (
      <div className={cn("flex items-end gap-1.5", isOwn ? "justify-end" : "justify-start")}>
        {!isOwn && <span aria-hidden="true" className="size-8 shrink-0" />}
        <div
          id={ancla}
          className={cn(
            "flex max-w-[78%] items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-2",
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

  const burbuja = (
    <div
      id={ancla}
      className={cn(
        "max-w-[78%] rounded-2xl px-4 py-2.5",
        "data-[destacado=true]:ring-2 data-[destacado=true]:ring-brand/60",
        isOwn
          ? "rounded-br-md bg-brand-tint text-foreground"
          : "rounded-bl-md bg-surface-subtle text-foreground",
      )}
    >
      {!isOwn && mostrarAutor && (
        // `foreground-secondary` y no `-muted`: son 12px sobre `surface-subtle`,
        // donde `-muted` se queda en 4.4:1 — por debajo del AA de texto normal.
        <p className="mb-0.5 text-xs font-semibold text-foreground-secondary">
          {autorNombre}
        </p>
      )}

      {respuesta && <ReplyQuote citado={respuesta} isOwn={isOwn} />}

      {media && <div className="-mx-2 mb-1.5">{media}</div>}

      {(body.trim().length > 0 || !media) && (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{body}</p>
      )}

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

  const avatar = !isOwn && (
    mostrarAutor ? (
      <Avatar src={autorAvatar} name={autorNombre} size="sm" />
    ) : (
      <span aria-hidden="true" className="size-8 shrink-0" />
    )
  );

  return (
    <ReaccionesProvider
      ambito="grupo"
      mensajeId={mensaje.mensajeId}
      hiloId={mensaje.hiloId}
      nombrePropio={mensaje.nombrePropio}
      iniciales={mensaje.reacciones ?? []}
    >
      <div className={cn("flex items-end gap-1.5", isOwn ? "justify-end" : "justify-start")}>
        {avatar}
        <MessageActions
          ambito="grupo"
          mensajeId={mensaje.mensajeId}
          hiloId={mensaje.hiloId}
          isOwn={isOwn}
          administro={mensaje.administro}
          kind={mensaje.kind}
          createdAt={mensaje.createdAt}
          body={body}
          autorNombre={autorNombre}
          compartido={mensaje.compartido ?? null}
        >
          {burbuja}
        </MessageActions>
      </div>
      <MessageReactions isOwn={isOwn} className={isOwn ? undefined : "pl-10"} />
    </ReaccionesProvider>
  );
}
