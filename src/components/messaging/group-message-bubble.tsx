import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui";

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
 */
export function GroupMessageBubble({
  body,
  isOwn,
  timeLabel,
  autorNombre,
  autorAvatar,
  mostrarAutor,
  acciones,
}: {
  body: string;
  isOwn: boolean;
  timeLabel: string;
  autorNombre: string;
  autorAvatar: string | null;
  mostrarAutor: boolean;
  /**
   * Menú del mensaje (borrar / reportar). Va del lado de AFUERA de la burbuja
   * —a la derecha de los mensajes ajenos, a la izquierda de los propios— para
   * que quede siempre contra el borde de la pantalla y nunca entre la foto de
   * quien escribió y lo que escribió.
   */
  acciones?: ReactNode;
}) {
  return (
    <div className={cn("flex items-end gap-1.5", isOwn ? "justify-end" : "justify-start")}>
      {isOwn && acciones}
      {!isOwn &&
        (mostrarAutor ? (
          <Avatar src={autorAvatar} name={autorNombre} size="sm" />
        ) : (
          <span aria-hidden="true" className="size-8 shrink-0" />
        ))}

      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-4 py-2.5",
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
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{body}</p>
        <p
          className={cn(
            "mt-1 text-[10px] text-foreground-secondary",
            isOwn ? "text-right" : "text-left",
          )}
        >
          {timeLabel}
        </p>
      </div>
      {!isOwn && acciones}
    </div>
  );
}
