import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CaretRight, LockKey } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/supabase/server";
import { getViewerFormatDate, getViewerTimeZone } from "@/lib/time/viewer-zone";
import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE } from "@/lib/utils";
import { Avatar, Banner, EmptyState } from "@/components/ui";
import { COPY } from "@/components/messaging/copy";
import { GroupComposer } from "@/components/messaging/group-composer";
import { GroupJoinButton } from "@/components/messaging/group-join-button";
import { GroupLive } from "@/components/messaging/group-live";
import { GroupMessageBubble } from "@/components/messaging/group-message-bubble";
import { ScrollAnchor } from "@/components/messaging/scroll-anchor";
import { miembrosLabel } from "@/lib/messaging/grupos";
import {
  listarMensajesDelGrupo,
  obtenerGrupo,
  perfilesDeAutores,
} from "../queries";

export const metadata: Metadata = { title: COPY.groups.title };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /mensajes/grupos/[id] — el chat del grupo.
 *
 * TRES ESTADOS y ninguno inventado:
 *   · No soy miembro y el grupo es público → veo la ficha y el botón para
 *     sumarme, no la conversación. (Los mensajes NO llegan: la policy de la
 *     0133 no me los devuelve. Esta pantalla no "esconde" nada, muestra lo que
 *     la base le dio.)
 *   · Soy miembro → el chat completo.
 *   · El grupo está cerrado → el chat en modo lectura, con el motivo escrito.
 *
 * Un grupo PRIVADO del que no soy miembro cae en `notFound()` porque la
 * consulta vuelve vacía: para quien no está adentro, no existe. Es lo correcto
 * — un 403 confirmaría que ese grupo existe.
 */
export default async function GrupoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const grupo = await obtenerGrupo(id, user.id);
  if (!grupo) notFound();

  const soyMiembro = grupo.miRol !== null;
  const cerrado = grupo.status === "closed";

  const encabezado = (
    <div className="flex items-center gap-3 border-b border-border-subtle pb-4">
      <Avatar src={grupo.avatar_url} name={grupo.name} size="lg" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-lg font-bold tracking-tight text-foreground">
          {grupo.name}
        </h1>
        <p className="truncate text-sm text-foreground-muted">
          {miembrosLabel(grupo.member_count)}
        </p>
      </div>
      {soyMiembro && (
        <Link
          href={`/mensajes/grupos/${grupo.id}/info`}
          className="flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-brand-ink transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          {COPY.groups.infoTitle}
          <CaretRight size={14} aria-hidden="true" />
        </Link>
      )}
    </div>
  );

  // ── No soy miembro: la ficha y la puerta, no la conversación ──────────────
  if (!soyMiembro) {
    return (
      <div className="flex flex-col gap-5">
        {encabezado}
        {grupo.description && (
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {grupo.description}
          </p>
        )}
        <EmptyState
          title={COPY.groups.notMemberTitle}
          message={COPY.groups.notMemberMessage}
          action={cerrado ? undefined : <GroupJoinButton groupId={grupo.id} />}
        />
      </div>
    );
  }

  const mensajes = await listarMensajesDelGrupo(grupo.id);
  const autores = await perfilesDeAutores(mensajes.map((m) => m.sender_id));

  /**
   * LA HORA DE UN MENSAJE ES LA HORA DE QUIEN LO LEE. Mismo criterio (y misma
   * trampa evitada) que el hilo 1-a-1: un solo huso para las burbujas y para
   * el separador de día, o un mensaje de las 22:30 en Los Ángeles aparece bajo
   * el día siguiente.
   */
  const [viewerZone, formatDate] = await Promise.all([
    getViewerTimeZone(),
    getViewerFormatDate(),
  ]);
  const timeFormat = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeStyle: "short",
    timeZone: viewerZone ?? DEFAULT_TIME_ZONE,
  });

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <GroupLive />

      {encabezado}

      {/* Nota TTL: minimización §5.4 comunicada como lo que es, una promesa. */}
      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-foreground-muted">
        <LockKey size={14} aria-hidden="true" className="shrink-0" />
        {COPY.groups.ttlNote}
      </p>

      <div className="flex flex-1 flex-col gap-2 py-5">
        {mensajes.length === 0 && (
          <EmptyState
            title={COPY.groups.emptyThreadTitle}
            message={COPY.groups.emptyThreadMessage}
          />
        )}

        {mensajes.map((mensaje, index) => {
          const previo = mensajes[index - 1];
          const dia = formatDate(mensaje.created_at);
          const mostrarDia = !previo || formatDate(previo.created_at) !== dia;
          const autor = autores.get(mensaje.sender_id);
          // El nombre se muestra al abrir una tanda: cambió el autor, o cambió
          // el día (después de un separador, la conversación empieza de nuevo).
          const mostrarAutor = mostrarDia || previo?.sender_id !== mensaje.sender_id;

          return (
            <div key={mensaje.id} className="flex flex-col gap-2">
              {mostrarDia && (
                <p className="py-2 text-center text-xs font-medium text-foreground-muted">
                  {dia}
                </p>
              )}
              <GroupMessageBubble
                body={mensaje.body}
                isOwn={mensaje.sender_id === user.id}
                timeLabel={timeFormat.format(new Date(mensaje.created_at))}
                autorNombre={autor?.displayName ?? "Miembro de la comunidad"}
                autorAvatar={autor?.avatarUrl ?? null}
                mostrarAutor={mostrarAutor}
              />
            </div>
          );
        })}

        {mensajes.length > 0 && (
          <ScrollAnchor signature={mensajes[mensajes.length - 1].id} />
        )}
      </div>

      {cerrado ? (
        <Banner variant="offline" className="mb-2 rounded-lg">
          {COPY.groups.closedBanner}
        </Banner>
      ) : (
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 -mx-1 bg-canvas/95 px-1 pb-2 pt-1 backdrop-blur-sm">
          <GroupComposer groupId={grupo.id} />
        </div>
      )}
    </div>
  );
}
