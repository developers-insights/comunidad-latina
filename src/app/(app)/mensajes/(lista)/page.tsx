import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cn, timeAgo } from "@/lib/utils";
import { Avatar, Badge, EmptyState } from "@/components/ui";
import { ConversationActions } from "@/components/messaging/conversation-actions";
import { COPY } from "@/components/messaging/copy";
import { InboxSearch } from "@/components/messaging/inbox-search";
import { InboxTabs } from "@/components/messaging/inbox-tabs";
import {
  agruparPorPersona,
  type ConversacionLite,
  type UltimoMensaje,
} from "@/lib/messaging/agrupar-por-persona";

export const metadata: Metadata = { title: COPY.inbox.title };

/**
 * /mensajes — bandeja del contacto protegido (§9.2), AGRUPADA POR PERSONA.
 *
 * Antes había una fila por conversación y, como cada conversación nace de un
 * aviso, la misma persona aparecía cuatro veces («Sobre: Gorra bordada»,
 * «Sobre: Barbería El Nítido»…). Es literalmente la foto que mandó el cliente
 * el 3/9. Ahora hay UNA fila por persona; el aviso pasó de ser el título de la
 * fila a ser contexto —una línea discreta acá, y la tarjeta del aviso adentro
 * del hilo, que ya existía—. El porqué de agrupar en la lectura y no en el
 * esquema está en `@/lib/messaging/agrupar-por-persona`.
 *
 * RLS ya limita a conversaciones donde soy created_by o counterpart; `blocked`
 * se filtra (ignorar = desaparece sin drama).
 */
export default async function MensajesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar");

  const { data } = await supabase
    .from("conversations")
    .select(
      `id, status, created_at, created_by, counterpart_id,
       listing:listings(id, title, kind),
       creator:profiles!conversations_created_by_fkey(id, display_name, avatar_url),
       counterpart:profiles!conversations_counterpart_id_fkey(id, display_name, avatar_url)`,
    )
    .neq("status", "blocked")
    .order("created_at", { ascending: false })
    .limit(100);

  const conversations = (data ?? []) as unknown as ConversacionLite[];

  // Último mensaje por conversación (una sola query, se reduce en memoria).
  const lastByConversation = new Map<string, UltimoMensaje>();
  if (conversations.length > 0) {
    const { data: recentMessages } = await supabase
      .from("messages")
      .select("conversation_id, sender_id, body, created_at")
      .in(
        "conversation_id",
        conversations.map((c) => c.id),
      )
      .order("created_at", { ascending: false })
      .limit(400);
    for (const message of (recentMessages ?? []) as UltimoMensaje[]) {
      if (!lastByConversation.has(message.conversation_id)) {
        lastByConversation.set(message.conversation_id, message);
      }
    }
  }

  const hilos = agruparPorPersona(conversations, lastByConversation, user.id);
  const now = new Date();

  return (
    <>
      <h1 className="mb-5 font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.inbox.title}
      </h1>

      <InboxTabs active="personas" />

      {/* El buscador va ARRIBA de la lista y se ve aunque la bandeja esté
          vacía: es justo cuando más falta hace («busco a Manuel y le
          escribo»), y esconderlo detrás de un estado vacío dejaría la pantalla
          sin ninguna salida. */}
      <InboxSearch />

      {hilos.length === 0 ? (
        // Sin CTA a propósito (pedido cliente 2026-07-20): la bandeja vacía
        // informa dónde van a aparecer las conversaciones. Ahora además tiene
        // el buscador justo arriba, que es la acción que sí corresponde.
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={COPY.inbox.emptyTitle}
          message={COPY.inbox.emptyMessage}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {hilos.map((hilo) => {
            const nombre = hilo.persona?.display_name ?? "Miembro de la comunidad";
            const ultimo = hilo.ultimoMensaje;
            // WCAG 1.4.1: una solicitud pendiente recibida NO se distingue sólo
            // por el borde de marca. Lleva además su propia línea de texto
            // ("Quiere contactarte por…") y la fila Aceptar/Ignorar, que ninguna
            // otra fila del inbox muestra. Si alguna vez se sacan esas dos, el
            // color queda solo y hace falta un label.
            const esSolicitud = hilo.solicitudRecibidaId !== null;

            return (
              <li
                key={hilo.personaId}
                // `border` NO va en la base: si estuviera, `border-2` de la rama
                // y `border` competirían por border-width y ganaría la que
                // Tailwind emita última, no la del ternario.
                // `border-brand-strong` (≥3:1 contra bg-surface para cualquier
                // tenant) porque acá el borde SÍ identifica un estado —
                // WCAG 1.4.11. Y el ancho no es adorno: en forced-colors todos
                // los border-color pasan a CanvasText y el color deja de
                // diferenciar; el ANCHO no.
                className={cn(
                  "rounded-lg bg-surface shadow-xs",
                  esSolicitud
                    ? "border-2 border-brand-strong"
                    : "border border-border-subtle",
                )}
              >
                <Link
                  href={`/mensajes/${hilo.conversacionPrincipalId}`}
                  className="flex items-start gap-3 rounded-lg p-4 transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                >
                  <Avatar src={hilo.persona?.avatar_url} name={nombre} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-semibold text-foreground">{nombre}</p>
                      <span className="shrink-0 text-xs text-foreground-muted">
                        {timeAgo(hilo.ultimaActividad, now)}
                      </span>
                    </div>

                    {esSolicitud ? (
                      <p className="mt-0.5 line-clamp-2 text-sm font-medium text-brand-ink">
                        {COPY.inbox.wantsToContact(hilo.solicitudRecibidaAviso)}
                      </p>
                    ) : ultimo ? (
                      <p className="mt-0.5 line-clamp-1 text-sm text-foreground-secondary">
                        {ultimo.sender_id === user.id && (
                          <span className="text-foreground-muted">{COPY.inbox.you} </span>
                        )}
                        {ultimo.body}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-sm text-foreground-muted">
                        {COPY.inbox.noMessagesYet}
                      </p>
                    )}

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {hilo.esperandoRespuesta && (
                        <Badge variant="neutral">{COPY.inbox.waitingReply}</Badge>
                      )}
                      {/* El aviso como CONTEXTO, no como título. Con varias
                          charlas se nombra la más reciente y se cuenta el resto:
                          tres títulos completos no entran en 375px. */}
                      {!esSolicitud && hilo.avisos.length > 0 && (
                        <span className="truncate text-xs text-foreground-muted">
                          {COPY.inbox.aboutListing(
                            COPY.inbox.alsoAbout(hilo.avisos[0], hilo.avisos.length - 1),
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>

                {hilo.solicitudRecibidaId && (
                  <div className="border-t border-border-subtle px-4 py-3">
                    <ConversationActions conversationId={hilo.solicitudRecibidaId} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
