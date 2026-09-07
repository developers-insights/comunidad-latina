import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HandWaving } from "@phosphor-icons/react/dist/ssr";
import { getAuthUserId } from "@/lib/supabase/server";
import { Avatar, EmptyState } from "@/components/ui";
import { cn, timeAgo } from "@/lib/utils";
import { ConversationActions } from "@/components/messaging/conversation-actions";
import { COPY } from "@/components/messaging/copy";
import { InboxTabs } from "@/components/messaging/inbox-tabs";
import { leerSolicitudes } from "../bandeja-queries";

export const metadata: Metadata = { title: COPY.inbox.solicitudesTitle };

/**
 * /mensajes/solicitudes — los pedidos de contacto sin responder.
 *
 * POR QUÉ SON UNA PESTAÑA Y NO UNA FILA MÁS DE LA BANDEJA
 * -------------------------------------------------------
 * Una solicitud no es una conversación: es una PREGUNTA con dos respuestas
 * posibles. Mezclada en la lista de Personas quedaba ordenada por fecha entre
 * charlas viejas, y la única forma de saber que había algo pendiente era
 * reconocer un borde de color. Acá tienen su lugar, su contador en la pestaña y
 * las tres salidas juntas.
 *
 * Cada tarjeta lleva el aviso por el que escriben y, si alcanzaron a escribir
 * algo, su primer mensaje: aceptar a ciegas —sabiendo sólo un nombre— es lo que
 * convierte esta pantalla en un trámite en vez de una decisión.
 *
 * NAVEGAR AL HILO NO ES UNA DE LAS SALIDAS: hasta que se acepta no hay nada que
 * leer ahí, y el banner de aceptar del hilo ya cubre a quien llega por un
 * enlace directo. El nombre sí lleva al perfil, que es donde se decide si uno
 * quiere hablar con alguien.
 */
export default async function SolicitudesPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/entrar?next=/mensajes/solicitudes");

  const solicitudes = await leerSolicitudes(userId);
  const ahora = new Date();

  return (
    <>
      <h1 className="mb-5 font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.inbox.title}
      </h1>

      <InboxTabs active="solicitudes" />

      {solicitudes.length === 0 ? (
        <EmptyState
          icon={<HandWaving size={32} aria-hidden="true" />}
          title={COPY.inbox.solicitudesEmptyTitle}
          message={COPY.inbox.solicitudesEmptyMessage}
        />
      ) : (
        <>
          <p className="mb-4 text-sm leading-relaxed text-foreground-secondary">
            {COPY.inbox.solicitudesIntro}
          </p>

          <ul className="flex flex-col gap-3">
            {solicitudes.map((solicitud) => (
              <li
                key={solicitud.conversationId}
                // `border-2 border-brand-strong` porque acá el borde SÍ
                // identifica un estado (WCAG 1.4.11) — y el ANCHO no es adorno:
                // en forced-colors todos los border-color pasan a CanvasText y
                // el color deja de diferenciar; el ancho no.
                className="rounded-lg border-2 border-brand-strong bg-surface p-4 shadow-xs"
              >
                <div className="flex items-start gap-3">
                  <Link
                    href={`/perfil/${solicitud.personaId}`}
                    className={cn(
                      "shrink-0 rounded-full",
                      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                    )}
                  >
                    <Avatar
                      src={solicitud.avatarUrl}
                      name={solicitud.nombre}
                      size="md"
                    />
                  </Link>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link
                        href={`/perfil/${solicitud.personaId}`}
                        className={cn(
                          "truncate font-semibold text-foreground",
                          "transition-colors duration-(--duration-fast) hover:text-brand-ink",
                          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                        )}
                      >
                        {solicitud.nombre}
                      </Link>
                      <time
                        dateTime={solicitud.creadaEn}
                        className="shrink-0 text-xs tabular-nums text-foreground-muted"
                      >
                        {timeAgo(solicitud.creadaEn, ahora)}
                      </time>
                    </div>

                    <p className="mt-0.5 text-sm font-medium text-brand-ink">
                      {COPY.inbox.wantsToContact(solicitud.avisoTitulo)}
                    </p>

                    {solicitud.primerMensaje && (
                      <p className="mt-2 line-clamp-3 rounded-md bg-surface-subtle px-3 py-2 text-sm leading-relaxed text-foreground-secondary">
                        <span className="sr-only">{COPY.inbox.firstMessage} </span>
                        {solicitud.primerMensaje}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 border-t border-border-subtle pt-3">
                  <ConversationActions
                    conversationId={solicitud.conversationId}
                    personaId={solicitud.personaId}
                    nombre={solicitud.nombre}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
