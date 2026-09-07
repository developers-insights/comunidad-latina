import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CaretRight, LockKey } from "@phosphor-icons/react/dist/ssr";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate, getViewerTimeZone } from "@/lib/time/viewer-zone";
import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE } from "@/lib/utils";
import { Avatar, Banner, EmptyState } from "@/components/ui";
import { leerReaccionesDeMensajes } from "@/lib/messaging/reacciones";
import { COPY } from "@/components/messaging/copy";
import { GroupComposer } from "@/components/messaging/group-composer";
import { GroupJoinButton } from "@/components/messaging/group-join-button";
import { GroupLive } from "@/components/messaging/group-live";
import {
  GroupMessageBubble,
  type GroupMessageMensaje,
} from "@/components/messaging/group-message-bubble";
import {
  MessageAttachment,
  firmarAdjuntosDelHilo,
} from "@/components/messaging/message-attachment";
import {
  ResponderProvider,
  resumenDeMensaje,
  type MensajeCitado,
} from "@/components/messaging/reply-quote";
import { PresenceBeat } from "@/components/messaging/presence-beat";
import { ScrollAnchor } from "@/components/messaging/scroll-anchor";
import {
  SharedCard,
  claveCompartido,
  resolverCompartidos,
} from "@/components/messaging/shared-card";
import {
  enlaceInternoDelCuerpo,
  esCompartidoKind,
  type EnlaceInterno,
} from "@/components/share/enlace-interno";
import { miembrosLabel, type MensajeDeGrupoRow } from "@/lib/messaging/grupos";
import {
  listarMensajesDelGrupo,
  obtenerGrupo,
  perfilesDeAutores,
} from "../queries";
import { SectionTopBar } from "@/components/shell";

export const metadata: Metadata = { title: COPY.groups.title };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los `kind` que traen algo para pintar además del texto (0136 §2.2). */
const KINDS_CON_MEDIA = new Set(["imagen", "video", "audio", "archivo", "ubicacion"]);

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
  const administro = grupo.miRol === "owner" || grupo.miRol === "admin";

  const encabezado = (
    <>
      {/* La salida del grupo, igual que en el resto de la app. Va adentro del
          encabezado porque las dos ramas de esta pantalla —miembro y no
          miembro— lo montan, y así ninguna queda sin salida. */}
      <SectionTopBar fallbackHref="/mensajes/grupos" />

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
    </>
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

  const sitio = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const origenesPropios = [sitio].filter(Boolean);

  // Mismo criterio que el hilo 1-a-1: la tarjeta llega por `compartido_*`
  // (panel de Compartir) o por un enlace nuestro pegado a mano, y los dos
  // caminos terminan en el mismo par `{kind, id}`.
  const compartidoDelMensaje = (mensaje: MensajeDeGrupoRow): EnlaceInterno | null => {
    if (mensaje.deleted_at) return null;
    if (esCompartidoKind(mensaje.compartido_kind) && mensaje.compartido_id) {
      return { kind: mensaje.compartido_kind, id: mensaje.compartido_id };
    }
    return enlaceInternoDelCuerpo(mensaje.body, { origenesPropios });
  };

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  /**
   * TODO LO QUE FALTA PARA PINTAR EL HILO, EN PARALELO.
   *
   * Ninguna de las seis depende de otra. `perfilesDeAutores` incluye MI id: el
   * "quién reaccionó" optimista necesita mi nombre y pedirlo aparte sería un
   * viaje más por una columna que esa consulta ya trae.
   */
  const [autores, reaccionesPorMensaje, compartidos, firmas, viewerZone, formatDate] =
    await Promise.all([
      perfilesDeAutores([...mensajes.map((m) => m.sender_id), user.id]),
      leerReaccionesDeMensajes(
        supabase,
        "grupo",
        mensajes.map((m) => m.id),
        user.id,
      ),
      resolverCompartidos(
        supabase,
        mensajes
          .map(compartidoDelMensaje)
          .filter((item): item is EnlaceInterno => item !== null),
        { locale: tenant.locale },
      ),
      firmarAdjuntosDelHilo(
        mensajes
          .map((mensaje) => mensaje.adjunto?.path)
          .filter((path): path is string => typeof path === "string" && path.length > 0),
      ),
      getViewerTimeZone(),
      getViewerFormatDate(),
    ]);

  /**
   * LA HORA DE UN MENSAJE ES LA HORA DE QUIEN LO LEE. Mismo criterio (y misma
   * trampa evitada) que el hilo 1-a-1: un solo huso para las burbujas y para
   * el separador de día, o un mensaje de las 22:30 en Los Ángeles aparece bajo
   * el día siguiente.
   */
  const timeFormat = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeStyle: "short",
    timeZone: viewerZone ?? DEFAULT_TIME_ZONE,
  });

  const nombreDe = (senderId: string) =>
    autores.get(senderId)?.displayName ?? "Miembro de la comunidad";
  const nombrePropio = nombreDe(user.id);

  /**
   * La cita se resuelve contra los mensajes YA cargados, sin consulta extra. Si
   * el original quedó fuera de los últimos 100, la respuesta se pinta sin cita:
   * perder la tirita es mucho más barato que un viaje por burbuja.
   */
  const porId = new Map(mensajes.map((mensaje) => [mensaje.id, mensaje]));
  const citaDe = (mensaje: MensajeDeGrupoRow): MensajeCitado | null => {
    if (!mensaje.reply_to) return null;
    const original = porId.get(mensaje.reply_to);
    if (!original) return null;
    return {
      id: original.id,
      autorNombre: nombreDe(original.sender_id),
      esPropio: original.sender_id === user.id,
      resumen: resumenDeMensaje(
        original.kind ?? "texto",
        original.body,
        Boolean(original.deleted_at),
      ),
    };
  };

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <GroupLive />
      <PresenceBeat />

      {encabezado}

      {/* Nota TTL: minimización §5.4 comunicada como lo que es, una promesa. */}
      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-foreground-muted">
        <LockKey size={14} aria-hidden="true" className="shrink-0" />
        {COPY.groups.ttlNote}
      </p>

      {/* El provider envuelve la LISTA y el COMPOSER: quien elige "Responder"
          está en el medio del hilo y quien lo usa está abajo de todo. */}
      <ResponderProvider>
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

            const isOwn = mensaje.sender_id === user.id;
            const kind = mensaje.kind ?? "texto";
            const compartido = compartidoDelMensaje(mensaje);
            const resuelto = compartido
              ? (compartidos.get(claveCompartido(compartido)) ?? null)
              : null;
            // El cuerpo que ES el enlace no se repite abajo de su tarjeta.
            const cuerpo =
              enlaceInternoDelCuerpo(mensaje.body, { origenesPropios }) !== null
                ? ""
                : mensaje.body;

            /**
             * `mensaje` reemplaza al viejo prop `acciones`: es el camino
             * completo del contrato de la burbuja —toque largo, reacciones,
             * cita y lápida— en vez del botón suelto al costado.
             */
            const acciones: GroupMessageMensaje = {
              mensajeId: mensaje.id,
              hiloId: grupo.id,
              createdAt: mensaje.created_at,
              kind,
              // Quien administra puede bajar mensajes ajenos: es lo mismo que
              // deja hacer la policy de la 0133 y la 0135.
              administro,
              nombrePropio,
              reacciones: reaccionesPorMensaje.get(mensaje.id) ?? [],
              compartido:
                compartido && resuelto
                  ? {
                      kind: compartido.kind,
                      id: compartido.id,
                      titulo: resuelto.titulo,
                      url: `${sitio}${resuelto.href}`,
                    }
                  : null,
            };

            const media = compartido ? (
              <SharedCard compartido={resuelto} kind={compartido.kind} isOwn={isOwn} />
            ) : KINDS_CON_MEDIA.has(kind) ? (
              <MessageAttachment
                kind={kind}
                adjunto={mensaje.adjunto ?? null}
                ubicacion={mensaje.ubicacion ?? null}
                src={
                  mensaje.adjunto?.path ? (firmas.get(mensaje.adjunto.path) ?? null) : null
                }
                isOwn={isOwn}
                autorNombre={nombreDe(mensaje.sender_id)}
              />
            ) : null;

            return (
              <div key={mensaje.id} className="flex flex-col gap-2">
                {mostrarDia && (
                  <p className="py-2 text-center text-xs font-medium text-foreground-muted">
                    {dia}
                  </p>
                )}
                <GroupMessageBubble
                  body={cuerpo}
                  isOwn={isOwn}
                  timeLabel={timeFormat.format(new Date(mensaje.created_at))}
                  autorNombre={autor?.displayName ?? "Miembro de la comunidad"}
                  autorAvatar={autor?.avatarUrl ?? null}
                  mostrarAutor={mostrarAutor}
                  mensaje={acciones}
                  editadoAt={mensaje.editado_at ?? null}
                  deletedAt={mensaje.deleted_at ?? null}
                  respuesta={citaDe(mensaje)}
                  media={media}
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
      </ResponderProvider>
    </div>
  );
}
