import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LockKey } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate, getViewerTimeZone } from "@/lib/time/viewer-zone";
import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE } from "@/lib/utils";
import { Banner } from "@/components/ui";
import type { Adjunto } from "@/lib/messaging/adjuntos";
import { supabaseSinTiparMensajes } from "@/lib/messaging/adjuntos";
import { leerReaccionesDeMensajes } from "@/lib/messaging/reacciones";
import { leerPresencia, presenciaVisible } from "@/lib/messaging/presencia";
import { PresenceBeat } from "@/components/messaging/presence-beat";
import { AcceptBanner } from "@/components/messaging/accept-banner";
import { Composer } from "@/components/messaging/composer";
import { COPY } from "@/components/messaging/copy";
import {
  MessageAttachment,
  firmarAdjuntosDelHilo,
} from "@/components/messaging/message-attachment";
import {
  MessageBubble,
  type MessageBubbleAcciones,
} from "@/components/messaging/message-bubble";
import {
  ResponderProvider,
  resumenDeMensaje,
  type MensajeCitado,
} from "@/components/messaging/reply-quote";
import { ScrollAnchor } from "@/components/messaging/scroll-anchor";
import { ThreadHeader } from "@/components/messaging/thread-header";
import { ThreadListingCard } from "@/components/messaging/thread-listing-card";
import { ThreadRefresh } from "@/components/messaging/thread-refresh";
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
import { toTrustProps } from "@/components/messaging/trust";

export const metadata: Metadata = { title: COPY.inbox.title };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProfileLite = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  identity_verified: boolean;
};

type ConversationRow = {
  id: string;
  status: string;
  created_at: string;
  created_by: string;
  counterpart_id: string;
  listing: {
    id: string;
    title: string;
    kind: string;
    photos: string[] | null;
    price_amount: number | null;
    price_currency: string | null;
    price_period: string | null;
  } | null;
  creator: ProfileLite | null;
  counterpart: ProfileLite | null;
};

/**
 * La fila tal como la devuelve la consulta de abajo. Las columnas de la 0136
 * son OPCIONALES en el tipo a propósito: mientras esa migración no esté
 * aplicada en un entorno, no vienen y el hilo se sigue leyendo como texto.
 */
type MessageRow = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  kind?: string | null;
  reply_to?: string | null;
  editado_at?: string | null;
  deleted_at?: string | null;
  compartido_kind?: string | null;
  compartido_id?: string | null;
  adjunto?: Adjunto | null;
  ubicacion?: { lat: number; lng: number; etiqueta?: string } | null;
};

/** Los `kind` que traen algo para pintar además del texto (0136 §2.2). */
const KINDS_CON_MEDIA = new Set(["imagen", "video", "audio", "archivo", "ubicacion"]);

/**
 * /mensajes/[id] — hilo del contacto protegido (§9.2): el cierre ocurre
 * ADENTRO. RLS garantiza que solo los participantes ven la conversación.
 */
export default async function HiloPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar");

  const { data } = await supabase
    .from("conversations")
    .select(
      `id, status, created_at, created_by, counterpart_id,
       listing:listings(id, title, kind, photos, price_amount, price_currency, price_period),
       creator:profiles!conversations_created_by_fkey(id, display_name, avatar_url, identity_verified),
       counterpart:profiles!conversations_counterpart_id_fkey(id, display_name, avatar_url, identity_verified)`,
    )
    .eq("id", id)
    .maybeSingle();

  const conversation = data as unknown as ConversationRow | null;
  if (!conversation) notFound();

  const iAmCreator = conversation.created_by === user.id;
  const other = iAmCreator ? conversation.counterpart : conversation.creator;
  const otherName = other?.display_name ?? "Miembro de la comunidad";
  const otherFirstName = otherName.split(/\s+/)[0] ?? otherName;
  const yo = iAmCreator ? conversation.creator : conversation.counterpart;
  // Cómo me llamo YO, para el "quién reaccionó" optimista. Sale de la misma
  // consulta que ya trae los dos perfiles: no cuesta un viaje extra.
  const nombrePropio = yo?.display_name ?? COPY.acciones.vos;

  const [{ data: trustRow }, { data: messagesData }] = await Promise.all([
    other
      ? supabase
          .from("trust_scores")
          .select("score, level, signals")
          .eq("profile_id", other.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // `supabaseSinTiparMensajes` porque `database.types.ts` se regenera a mano
    // y todavía no conoce las columnas de la 0136. La forma real de la fila la
    // fija `MessageRow`; cuando los tipos se regeneren, este escape se borra.
    supabaseSinTiparMensajes(supabase)
      .from("messages")
      .select(
        "id, sender_id, body, created_at, kind, reply_to, editado_at, deleted_at, compartido_kind, compartido_id, adjunto, ubicacion",
      )
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);

  const messages = (messagesData ?? []) as MessageRow[];
  const trust = toTrustProps(trustRow, other?.identity_verified ?? false);

  /**
   * LAS TARJETAS DEL HILO, RESUELTAS DE UNA SOLA VEZ.
   *
   * Un mensaje puede traer una publicación adentro por dos caminos, y los dos
   * terminan en el mismo par `{kind, id}`:
   *
   *  · lo mandaron desde el panel de Compartir → viene en `compartido_kind` /
   *    `compartido_id` (0136);
   *  · alguien PEGÓ el link a mano → `enlaceInternoDelCuerpo` lo reconoce, pero
   *    SÓLO si es un enlace de este sitio y el cuerpo es el enlace y nada más.
   *
   * `resolverCompartidos` agrupa por TABLA, así que doscientos mensajes con
   * tarjeta cuestan cuatro consultas y no doscientas. Se pide una sola vez, acá,
   * y las burbujas leen del mapa.
   */
  /**
   * Qué contamos como "un enlace nuestro": SÓLO el origin canónico.
   *
   * `Tenant` no tiene un campo de dominio propio, así que el dominio con el que
   * cada comunidad se sirve no se puede saber desde acá sin inventarlo — y un
   * origin inventado en esta lista es una puerta abierta, no una comodidad. El
   * costo de quedarse corto es chico y visible: un link copiado desde el dominio
   * de la comunidad se ve como texto en vez de como tarjeta. El costo de pasarse
   * es pintar contenido ajeno con nuestra marca alrededor.
   */
  const sitio = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const origenesPropios = [sitio].filter(Boolean);

  const compartidoDelMensaje = (message: MessageRow): EnlaceInterno | null => {
    // Un mensaje bajado no conserva payload (0142): no hay tarjeta que resolver.
    if (message.deleted_at) return null;
    if (esCompartidoKind(message.compartido_kind) && message.compartido_id) {
      return { kind: message.compartido_kind, id: message.compartido_id };
    }
    return enlaceInternoDelCuerpo(message.body, { origenesPropios });
  };

  /**
   * LAS LECTURAS QUE FALTAN, EN PARALELO.
   *
   * Ninguna depende del resultado de otra: encadenarlas sería sumar un viaje de
   * latencia por cada una a la pantalla que más se abre del módulo. La presencia
   * entra a esta misma tanda —y no a un efecto del cliente— para que el
   * encabezado se pinte completo de una, sin un "En línea" que aparece tarde.
   */
  const [compartidos, reaccionesPorMensaje, firmas, viewerZone, formatDate, presencias] =
    await Promise.all([
      resolverCompartidos(
        supabase,
        messages
          .map(compartidoDelMensaje)
          .filter((item): item is EnlaceInterno => item !== null),
        { locale: tenant.locale },
      ),
      leerReaccionesDeMensajes(
        supabase,
        "directo",
        messages.map((message) => message.id),
        user.id,
      ),
      firmarAdjuntosDelHilo(
        messages
          .map((message) => message.adjunto?.path)
          .filter((path): path is string => typeof path === "string" && path.length > 0),
      ),
      getViewerTimeZone(),
      getViewerFormatDate(),
      leerPresencia(supabase, other ? [other.id] : []),
    ]);

  /**
   * LA HORA DE UN MENSAJE ES LA HORA DE QUIEN LO LEE.
   *
   * Este `Intl.DateTimeFormat` corría sin `timeZone`: el server pintaba la hora
   * en UTC y el navegador la reescribía al hidratar. En un chat eso se ve —
   * "20:14" saltando a "16:14" delante de la persona— y encima el separador de
   * día ("hoy" / "ayer") se calculaba con OTRO reloj que las burbujas, así que
   * un mensaje de las 22:30 en Los Ángeles podía aparecer bajo el día siguiente.
   * Un solo huso para las dos cosas y el hilo vuelve a ser coherente.
   */
  const timeFormat = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeStyle: "short",
    timeZone: viewerZone ?? DEFAULT_TIME_ZONE,
  });

  const nombreDe = (senderId: string) =>
    senderId === user.id ? nombrePropio : otherName;

  /**
   * LA CITA SE RESUELVE CONTRA LO QUE YA SE CARGÓ, sin una consulta más.
   *
   * Si el original quedó fuera de los últimos 200 mensajes, la respuesta se
   * pinta sin cita en vez de disparar un viaje por burbuja: perder la tirita es
   * mucho más barato que convertir el hilo en un N+1.
   */
  const porId = new Map(messages.map((message) => [message.id, message]));
  const citaDe = (message: MessageRow): MensajeCitado | null => {
    if (!message.reply_to) return null;
    const original = porId.get(message.reply_to);
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

  const isAccepted = conversation.status === "accepted";
  const isPending = conversation.status === "pending";
  const isBlocked = conversation.status === "blocked";

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <ThreadRefresh />
      <PresenceBeat />

      <ThreadHeader
        otherProfile={{
          id: other?.id ?? "",
          displayName: otherName,
          avatarUrl: other?.avatar_url ?? null,
        }}
        trust={trust}
        presencia={
          other ? (presenciaVisible(presencias.get(other.id)) ?? undefined) : undefined
        }
        // El aviso ya no viaja en el header: ahora es la tarjeta de abajo, que
        // se lee de un vistazo. Repetir el título en 12 px al lado del Trust
        // Score era competir por el mismo renglón y quedaba truncado casi
        // siempre.
        listing={null}
      />

      {/* LA TARJETA DEL AVISO, ARRIBA DE TODO (§3): las dos partes tienen que
          saber de qué anuncio están hablando antes del primer mensaje. */}
      {conversation.listing && (
        <ThreadListingCard
          className="mt-3"
          locale={tenant.locale}
          listing={{
            id: conversation.listing.id,
            kind: conversation.listing.kind,
            title: conversation.listing.title,
            photos: conversation.listing.photos,
            priceAmount: conversation.listing.price_amount,
            priceCurrency: conversation.listing.price_currency,
            pricePeriod: conversation.listing.price_period,
          }}
        />
      )}

      {/* Aviso fijo de seguridad (§9.2) — discreto, siempre visible arriba del hilo */}
      <Banner variant="info" className="mt-4 rounded-lg">
        {COPY.thread.safetyBanner}
      </Banner>

      {/* Nota TTL: minimización §5.4 comunicada como feature de privacidad */}
      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-foreground-muted">
        <LockKey size={14} aria-hidden="true" className="shrink-0" />
        {COPY.thread.ttlNote}
      </p>

      {/* El provider envuelve la LISTA y el COMPOSER: quien elige "Responder"
          está en el medio del hilo y quien lo usa está abajo de todo. */}
      <ResponderProvider>
        <div className="flex flex-1 flex-col gap-2.5 py-5">
          {messages.length === 0 && isAccepted && (
            <p className="py-8 text-center text-sm text-foreground-muted">
              {COPY.thread.emptyThread}
            </p>
          )}

          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const dayLabel = formatDate(message.created_at);
            const showDay = !previous || formatDate(previous.created_at) !== dayLabel;

            const isOwn = message.sender_id === user.id;
            const kind = message.kind ?? "texto";
            const timeLabel = timeFormat.format(new Date(message.created_at));
            const compartido = compartidoDelMensaje(message);
            const resuelto = compartido
              ? (compartidos.get(claveCompartido(compartido)) ?? null)
              : null;
            /**
             * Cuando el cuerpo ES el enlace y nada más, la tarjeta lo dice
             * todo: repetir la URL abajo es la misma información dos veces, y
             * la segunda sin formato.
             */
            const cuerpo =
              enlaceInternoDelCuerpo(message.body, { origenesPropios }) !== null
                ? ""
                : message.body;

            const acciones: MessageBubbleAcciones = {
              mensajeId: message.id,
              hiloId: conversation.id,
              createdAt: message.created_at,
              kind,
              autorNombre: nombreDe(message.sender_id),
              nombrePropio,
              reacciones: reaccionesPorMensaje.get(message.id) ?? [],
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

            /**
             * Lo que el mensaje ES cuando no es texto. Va adentro de la burbuja
             * (prop `media`) y no al costado: así el menú, las reacciones y la
             * cita siguen siendo los de ESTE mensaje. Una foto pintada afuera
             * se quedaba sin las tres cosas.
             */
            const media = compartido ? (
              <SharedCard compartido={resuelto} kind={compartido.kind} isOwn={isOwn} />
            ) : KINDS_CON_MEDIA.has(kind) ? (
              <MessageAttachment
                kind={kind}
                adjunto={message.adjunto ?? null}
                ubicacion={message.ubicacion ?? null}
                src={
                  message.adjunto?.path
                    ? (firmas.get(message.adjunto.path) ?? null)
                    : null
                }
                isOwn={isOwn}
                autorNombre={nombreDe(message.sender_id)}
              />
            ) : null;

            return (
              <div key={message.id} className="flex flex-col gap-2.5">
                {showDay && (
                  <p className="py-2 text-center text-xs font-medium text-foreground-muted">
                    {dayLabel}
                  </p>
                )}
                <MessageBubble
                  body={cuerpo}
                  isOwn={isOwn}
                  timeLabel={timeLabel}
                  acciones={acciones}
                  editadoAt={message.editado_at ?? null}
                  deletedAt={message.deleted_at ?? null}
                  respuesta={citaDe(message)}
                  media={media}
                />
              </div>
            );
          })}

          {messages.length > 0 && (
            <ScrollAnchor signature={messages[messages.length - 1].id} />
          )}
        </div>

        {/* Pie según estado: solo accepted escribe (§9.2) */}
        {isAccepted && (
          <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 -mx-1 bg-canvas/95 px-1 pb-2 pt-1 backdrop-blur-sm">
            <Composer conversationId={conversation.id} />
          </div>
        )}
      </ResponderProvider>

      {isPending && !iAmCreator && (
        <div className="pb-2">
          <AcceptBanner
            conversationId={conversation.id}
            otherName={otherFirstName}
            listingTitle={conversation.listing?.title ?? null}
          />
        </div>
      )}

      {isPending && iAmCreator && (
        <Banner variant="offline" className="mb-2 rounded-lg">
          {COPY.thread.pendingAsCreator}
        </Banner>
      )}

      {isBlocked && (
        <Banner variant="offline" className="mb-2 rounded-lg">
          {COPY.thread.blockedNotice}
        </Banner>
      )}
    </div>
  );
}
