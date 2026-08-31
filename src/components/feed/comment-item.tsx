import { Storefront } from "@phosphor-icons/react/dist/ssr";
import { Avatar } from "@/components/ui";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import { CommunityEmojiText } from "@/components/emojis";
import type { CommunityEmoji } from "@/lib/emojis/catalog";
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
  /**
   * La ficha con la que se firmó el comentario (0116). Cuando viene, el
   * comentario se pinta a nombre del NEGOCIO: su foto, su nombre y la insignia
   * de local.
   *
   * Y sin el Trust Score, que es lo que sorprende y es correcto: la confianza
   * es de la PERSONA que está detrás, no del comercio. Colgarle el puntaje de
   * su dueño a un nombre comercial sería afirmar algo que la app no midió — y
   * al lado de un nombre que no es el de esa persona, nadie podría saber de
   * quién habla. Quien quiera saber quién está atrás tiene la página del
   * negocio, que sí muestra a su dueño con su puntaje.
   */
  entity?: { nombre: string; avatarUrl: string | null } | null;
  body: string;
  /**
   * Catálogo de emojis propios ACTIVOS, para cambiar los códigos cortos
   * (`:klk:`) por su dibujo. Lo trae `readCommunityEmojiCatalog()` desde el
   * server component que arma el hilo.
   *
   * Opcional y con default vacío a propósito: sin catálogo el cuerpo se pinta
   * tal cual, que es exactamente lo que corresponde mientras los emojis estén
   * apagados. Así el código corto nunca queda a la vista como texto crudo en
   * una superficie y renderizado en otra.
   */
  emojiCatalog?: readonly CommunityEmoji[];
  /**
   * Texto del slot de tiempo. El padre decide qué va: "hace 3 min" para uno ya
   * publicado, o el copy de "Enviando…" para el comentario optimista en vuelo.
   */
  timeAgoLabel: string;
  /** Optimista en vuelo: baja la opacidad hasta que el servidor confirma. */
  pending?: boolean;
  /**
   * Sobre qué está apoyado el comentario:
   *  · "surface" (default) — la superficie de la app, con los tokens de tema.
   *  · "media"   — el vidrio de la hoja SOBRE UN VIDEO. Ahí la burbuja clara
   *    sería justo el "fondo blanco que bloquea el video" que pidió sacar el
   *    cliente (2026-07-27): se cambia por un velo de TINTA (más oscuro que el
   *    vidrio, no más claro) con texto `on-media`. Hundir la burbuja en vez de
   *    levantarla es lo que salva el contraste: contra el peor caso —video
   *    blanco detrás— el cuerpo queda en ~9:1 y el "hace 3 min" en ~6.7:1,
   *    mientras que una burbuja clara los dejaba en 5.3:1 y 4.1:1 (esto último,
   *    por debajo de AA).
   */
  tone?: "surface" | "media";
  /**
   * Slot del menú ⋯ del comentario (`CommentMenu`, 0097). Es un SLOT y no un
   * juego de props (`viewerId`, `postAuthorId`, `onDeleted`…) por lo que dice el
   * docblock de arriba: este módulo corre igual en el servidor y en el cliente,
   * y no puede llevar estado. Quien lo monta ya sabe quién está mirando y qué
   * hacer cuando el comentario desaparece; acá sólo se le reserva el lugar.
   * Ausente → el comentario se pinta exactamente como antes.
   */
  menu?: React.ReactNode;
}

export function CommentItem({
  author,
  entity = null,
  body,
  emojiCatalog,
  timeAgoLabel,
  pending = false,
  tone = "surface",
  menu,
}: CommentItemProps) {
  const onMedia = tone === "media";
  return (
    <li
      className={cn(
        "flex items-start gap-2.5",
        // El optimista se atenúa mientras viaja: señal honesta de "todavía no está
        // firme" sin sacarlo de la lista (mataría la sensación de instantáneo).
        pending && "opacity-60",
      )}
    >
      <Avatar
        size="sm"
        name={entity ? entity.nombre : author.displayName}
        src={entity ? entity.avatarUrl : author.avatarUrl}
        badge={
          entity ? (
            <span
              aria-hidden="true"
              className="cl-print-hide flex size-3.5 items-center justify-center rounded-full bg-brand text-brand-foreground ring-2 ring-surface"
            >
              <Storefront size={9} weight="fill" />
            </span>
          ) : undefined
        }
      />
      <div
        className={cn(
          "min-w-0 flex-1 rounded-lg px-3.5 py-2.5",
          onMedia
            ? "bg-media-shade/35 ring-1 ring-inset ring-on-media/10"
            : "bg-surface-subtle",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span
            className={cn(
              "truncate text-sm font-semibold",
              onMedia ? "text-on-media" : "text-foreground",
            )}
          >
            {entity ? entity.nombre : author.displayName}
          </span>
          {!entity && author.profileId && (
            <PublisherTrust
              displayName={author.displayName}
              firstName={firstNameOf(author.displayName)}
              score={author.score}
              level={author.level}
              signals={author.signals}
              profileId={author.profileId}
              size="inline"
            />
          )}
          <span
            className={cn(
              "text-xs",
              onMedia ? "text-on-media/80" : "text-foreground-muted",
            )}
          >
            · {timeAgoLabel}
          </span>
          {/* Último en el DOM y a la derecha por `ml-auto`: el lector de
              pantalla anuncia de quién es el comentario y de cuándo ANTES de
              ofrecer "opciones", que es el orden en que la gente lo lee. */}
          {menu && <div className="ml-auto shrink-0">{menu}</div>}
        </div>
        <p
          className={cn(
            "mt-1 whitespace-pre-wrap text-sm leading-relaxed",
            onMedia ? "text-on-media" : "text-foreground",
          )}
        >
          <CommunityEmojiText text={body} catalog={emojiCatalog ?? []} />
        </p>
      </div>
    </li>
  );
}
