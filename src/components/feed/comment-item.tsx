import { Avatar } from "@/components/ui";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import { cn } from "@/lib/utils";
import type { AuthorView } from "./helpers";

/**
 * Un comentario del hilo: avatar + nombre + Trust inline + tiempo + cuerpo.
 *
 * FUENTE ÚNICA del markup del item — se usa TAL CUAL en dos lugares:
 *  1. El detalle SSR /feed/[id] (server component, para deep links).
 *  2. La hoja de comentarios del feed (client, camino tipo Instagram).
 * Antes vivía duplicado en la página; extraerlo evita que los dos se desincronicen.
 *
 * Es presentacional y SIN estado (no lleva "use client"): así el mismo módulo
 * corre en el servidor (detalle) y en el cliente (hoja) sin fricción. El único
 * hijo interactivo, `PublisherTrust`, ya es su propia isla cliente.
 */
export interface CommentItemProps {
  /** Autor ya resuelto (perfil + Trust). Sin profileId → miembro anónimo (sin badge). */
  author: AuthorView;
  body: string;
  /**
   * Texto del slot de tiempo. El padre decide qué va: "hace 3 min" para uno ya
   * publicado, o el copy de "Enviando…" para el comentario optimista en vuelo.
   */
  timeAgoLabel: string;
  /** Optimista en vuelo: baja la opacidad hasta que el servidor confirma. */
  pending?: boolean;
}

export function CommentItem({ author, body, timeAgoLabel, pending = false }: CommentItemProps) {
  return (
    <li
      className={cn(
        "flex items-start gap-2.5",
        // El optimista se atenúa mientras viaja: señal honesta de "todavía no está
        // firme" sin sacarlo de la lista (mataría la sensación de instantáneo).
        pending && "opacity-60",
      )}
    >
      <Avatar size="sm" name={author.displayName} src={author.avatarUrl} />
      <div className="min-w-0 flex-1 rounded-lg bg-surface-subtle px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-semibold text-foreground">
            {author.displayName}
          </span>
          {author.profileId && (
            <PublisherTrust
              displayName={author.displayName}
              firstName={firstNameOf(author.displayName)}
              score={author.score}
              level={author.level}
              signals={author.signals}
              size="inline"
            />
          )}
          <span className="text-xs text-foreground-muted">· {timeAgoLabel}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {body}
        </p>
      </div>
    </li>
  );
}
