import {
  Article,
  Checks,
  Image as IconoFoto,
  MapPin,
  Microphone,
  Paperclip,
  UserCircle,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge } from "@/components/ui";
import { cn, timeAgo } from "@/lib/utils";
import type { FilaDeBandeja, IconoDeResumen } from "@/lib/messaging/bandeja";
import type { EstadoDePresencia } from "@/lib/messaging/presencia";
import { topicoDeDirecto } from "@/lib/messaging/escribiendo";
import { COPY } from "./copy";
import { RenglonEnVivo } from "./escribiendo-live";
import { InboxRowLink } from "./inbox-row-link";

/**
 * UNA FILA DE LA BANDEJA — qué pasó, de un vistazo.
 *
 * Lo que la fila tiene que contestar sin que nadie la abra: con quién, qué
 * llegó ("Nota de voz · 0:24", "Foto"), cuándo, cuánto falta por leer, y —si el
 * último mensaje es mío— si ya lo abrieron.
 *
 * ── LOS TRES ESTADOS EN VIVO, Y POR DÓNDE LLEGA CADA UNO ────────────────────
 * `en-linea` y `ultima-vez` los resuelve el SERVIDOR con la RPC `presencia_de`
 * (0145) y bajan pintados en las props. `escribiendo` llega por otro lado —
 * Realtime broadcast (0148), directo al navegador— y por eso no viaja en
 * `presencia`: son dos relojes distintos, uno de minutos y otro de segundos.
 *
 * La objeción que lo tuvo apagado hasta hoy era correcta: derivado del refresco
 * de 15 s, el cartel aparecía cuando la persona ya había dejado de escribir, y
 * eso no es una versión pobre del dato sino un dato falso. Con la 0143 el
 * proyecto tiene Realtime y el aviso llega en el momento o no llega.
 *
 * Server Component: lo único cliente es el enlace —que además deja anotada la
 * lectura, ver `inbox-row-link.tsx`— y `RenglonEnVivo`, que tapa el resumen
 * mientras alguien teclea del otro lado.
 */

const ICONO: Record<IconoDeResumen, React.ComponentType<{ size?: number; weight?: "fill" | "bold" | "regular" }>> = {
  imagen: IconoFoto,
  video: VideoCamera,
  audio: Microphone,
  archivo: Paperclip,
  ubicacion: MapPin,
  perfil: UserCircle,
  contenido: Article,
};

export function InboxRow({
  fila,
  miId,
  ahora,
  presencia,
}: {
  fila: FilaDeBandeja;
  miId: string;
  ahora: Date;
  presencia?: EstadoDePresencia;
}) {
  const nombre = fila.persona?.display_name ?? "Miembro de la comunidad";
  const sinLeer = fila.noLeidos > 0;
  const Icono = fila.resumen?.icono ? ICONO[fila.resumen.icono] : null;
  const esMio = fila.ultimoMensaje?.sender_id === miId;

  return (
    <li className="rounded-lg border border-border-subtle bg-surface shadow-xs">
      <InboxRowLink
        href={`/mensajes/${fila.conversacionPrincipalId}`}
        conversationId={fila.conversacionPrincipalId}
        marcarLeida={sinLeer}
        className={cn(
          "flex items-start gap-3 rounded-lg p-4",
          "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
          "hover:bg-surface-subtle",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <span className="relative shrink-0">
          <Avatar src={fila.persona?.avatar_url} name={nombre} size="md" />
          {presencia?.tipo === "en-linea" && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-success ring-2 ring-surface"
            />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            {/* `min-w-0` NO es decoración: `truncate` pone `white-space:nowrap`,
                y un ítem flex con nowrap tiene tamaño mínimo automático igual a
                su contenido. Sin esto, un nombre largo no se corta — empuja la
                hora fuera de la pantalla y la fila entera desborda a 375px. */}
            <span
              className={cn(
                "min-w-0 truncate text-foreground",
                sinLeer ? "font-bold" : "font-semibold",
              )}
            >
              {nombre}
            </span>
            <time
              dateTime={fila.ultimaActividad}
              className={cn(
                "shrink-0 text-xs tabular-nums",
                sinLeer ? "font-semibold text-brand-ink" : "text-foreground-muted",
              )}
            >
              {timeAgo(fila.ultimaActividad, ahora)}
            </time>
          </span>

          <span className="mt-0.5 flex items-center gap-1.5">
            {/* El tilde va ANTES del texto, como en cualquier chat: es un dato
                sobre el mensaje que sigue, no sobre la fila. */}
            {esMio && fila.leidoPorElOtro && (
              <>
                <Checks
                  size={15}
                  weight="bold"
                  aria-hidden="true"
                  className="shrink-0 text-brand-ink"
                />
                <span className="sr-only">{COPY.inbox.readByOther}. </span>
              </>
            )}

            <RenglonEnVivo
              topico={topicoDeDirecto(fila.conversacionPrincipalId)}
              className="min-w-0 text-sm font-medium"
            >
            {fila.resumen ? (
              <>
                {Icono && (
                  <span aria-hidden="true" className="shrink-0 text-foreground-muted">
                    <Icono size={15} />
                  </span>
                )}
                {esMio && !fila.leidoPorElOtro && (
                  <span className="shrink-0 text-sm text-foreground-muted">
                    {COPY.inbox.you}
                  </span>
                )}
                <span
                  className={cn(
                    "min-w-0 truncate text-sm",
                    sinLeer ? "font-medium text-foreground" : "text-foreground-secondary",
                  )}
                >
                  {fila.resumen.texto}
                </span>
              </>
            ) : (
              <span className="min-w-0 truncate text-sm text-foreground-muted">
                {COPY.inbox.noMessagesYet}
              </span>
            )}
            </RenglonEnVivo>

            {sinLeer && (
              <span
                className={cn(
                  "ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5",
                  "bg-brand text-[11px] font-bold leading-none tabular-nums text-brand-foreground",
                  // La fila es un <li> con un <Link>, no un <button> ni un <nav>:
                  // nada del bloque @media print la alcanza. Sin este hook, el
                  // globito sale en papel como un número suelto sobre un relleno
                  // que la impresora no imprime — ilegible y sin sentido fuera
                  // de la pantalla.
                  "cl-print-hide",
                )}
              >
                {fila.noLeidos > 99 ? "99+" : fila.noLeidos}
                <span className="sr-only"> {COPY.inbox.unreadCount(fila.noLeidos)}</span>
              </span>
            )}
          </span>

          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {fila.esperandoRespuesta && (
              <Badge variant="neutral">{COPY.inbox.waitingReply}</Badge>
            )}
            {/* El punto verde del avatar es `aria-hidden`, así que sin este
                renglón "en línea" existiría sólo para quien puede verlo. */}
            {presencia?.tipo === "en-linea" && (
              <span className="text-xs font-medium text-success">
                {COPY.inbox.resumen.enLinea}
              </span>
            )}
            {presencia?.tipo === "ultima-vez" && (
              <span className="text-xs text-foreground-muted">
                {COPY.inbox.resumen.ultimaVez(presencia.cuando)}
              </span>
            )}
            {/* El aviso como CONTEXTO, no como título. Con varias charlas se
                nombra la más reciente y se cuenta el resto: tres títulos
                completos no entran en 375px. */}
            {fila.avisos.length > 0 && (
              <span className="min-w-0 truncate text-xs text-foreground-muted">
                {COPY.inbox.aboutListing(
                  COPY.inbox.alsoAbout(fila.avisos[0], fila.avisos.length - 1),
                )}
              </span>
            )}
          </span>
        </span>
      </InboxRowLink>
    </li>
  );
}
