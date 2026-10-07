import { notFound, redirect } from "next/navigation";
import { LockKey } from "@phosphor-icons/react/dist/ssr";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate, getViewerTimeZone } from "@/lib/time/viewer-zone";
import { cn, DEFAULT_LOCALE, DEFAULT_TIME_ZONE } from "@/lib/utils";
import { Banner } from "@/components/ui";
import {
  leerConversacion,
  leerMensajesDelHilo,
  type MensajeDelHilo,
} from "@/lib/messaging/hilo-queries";
import { leerReaccionesDeMensajes } from "@/lib/messaging/reacciones";
import { leerPresencia, presenciaVisible } from "@/lib/messaging/presencia";
import { topicoDeDirecto } from "@/lib/messaging/escribiendo";
import { readCommunityEmojiCatalog } from "@/lib/emojis/queries";
import { AcceptBanner } from "@/components/messaging/accept-banner";
import { EscribiendoProvider } from "@/components/messaging/escribiendo-live";
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
  type MensajeCitado,
} from "@/components/messaging/reply-quote";
import { resumenDeMensaje } from "@/components/messaging/helpers-de-mensaje";
import { ScrollAnchor } from "@/components/messaging/scroll-anchor";
import { EnVueloSiFalta, MensajesEnVuelo } from "@/components/messaging/en-vuelo";
import { HiloEnVivo } from "@/components/messaging/hilo-en-vivo";
import { RefrescoEnVivo } from "@/components/notifications/refresco-en-vivo";
import { CLASE_PIE_EN_LLAMADA } from "@/components/messaging/clases-en-llamada";
import { ThreadHeader } from "@/components/messaging/thread-header";
import { ThreadListingCard } from "@/components/messaging/thread-listing-card";
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
import { sigueDescartada } from "@/lib/messaging/solicitud-descartada";

type MessageRow = MensajeDelHilo;

/** Los `kind` que traen algo para pintar además del texto (0136 §2.2). */
const KINDS_CON_MEDIA = new Set([
  "imagen",
  "video",
  "audio",
  "archivo",
  "ubicacion",
]);

/**
 * El hilo del contacto protegido (§9.2): el cierre ocurre ADENTRO. RLS
 * garantiza que solo los participantes ven la conversación.
 *
 * Lo montan dos lugares: `/mensajes/[id]` (variante "pagina") y el panel de
 * chat de la pantalla de llamada (variante "llamada"). En la llamada NUNCA se
 * llama a `notFound()`/`redirect()`: cortarían la página entera y con ella la
 * llamada de Agora; si algo falta, el panel queda vacío y nada más.
 */
export async function HiloDirecto({
  id,
  variante,
}: {
  id: string;
  variante: "pagina" | "llamada";
}) {
  const enLlamada = variante === "llamada";

  /**
   * TODO ARRANCA A LA VEZ y cada lectura espera sólo lo que necesita: la
   * confianza y la presencia, a la otra persona (sale de la conversación);
   * reacciones, firmas y tarjetas, a los mensajes. Eran cinco viajes en fila
   * (getUser → conversación → mensajes → derivados); el camino más largo ahora
   * es de dos. `getAuthUserId` verifica el JWT local: esto es lectura, y las
   * actions que escriben siguen pidiendo `getUser`.
   */
  const supabaseP = createClient();
  const tenantP = getTenant();
  const mensajesP = leerMensajesDelHilo(id);
  const zonaP = getViewerTimeZone();
  const formatoP = getViewerFormatDate();
  const emojisP = readCommunityEmojiCatalog();

  const [userId, conversation] = await Promise.all([getAuthUserId(), leerConversacion(id)]);
  if (!userId) {
    if (enLlamada) return null;
    redirect(`/entrar?next=/mensajes/${id}`);
  }
  if (!conversation) {
    if (enLlamada) return null;
    notFound();
  }

  const iAmCreator = conversation.created_by === userId;
  const other = iAmCreator ? conversation.counterpart : conversation.creator;
  const otherName = other?.display_name ?? "Miembro de la comunidad";
  const otherFirstName = otherName.split(/\s+/)[0] ?? otherName;
  const yo = iAmCreator ? conversation.creator : conversation.counterpart;
  // Cómo me llamo YO, para el "quién reaccionó" optimista. Sale de la misma
  // consulta que ya trae los dos perfiles: no cuesta un viaje extra.
  const nombrePropio = yo?.display_name ?? COPY.acciones.vos;

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

  /**
   * Un mensaje puede traer una publicación por dos caminos que terminan en el
   * mismo par `{kind, id}`: el panel de Compartir (`compartido_kind` /
   * `compartido_id`, 0136) o un enlace de este sitio PEGADO a mano, que
   * `enlaceInternoDelCuerpo` reconoce sólo si el cuerpo es el enlace y nada más.
   */
  const compartidoDelMensaje = (message: MessageRow): EnlaceInterno | null => {
    // Un mensaje bajado no conserva payload (0142): no hay tarjeta que resolver.
    if (message.deleted_at) return null;
    if (esCompartidoKind(message.compartido_kind) && message.compartido_id) {
      return { kind: message.compartido_kind, id: message.compartido_id };
    }
    return enlaceInternoDelCuerpo(message.body, { origenesPropios });
  };

  /**
   * `resolverCompartidos` agrupa por TABLA: doscientos mensajes con tarjeta
   * cuestan cuatro consultas y no doscientas. Lo mismo reacciones y firmas.
   */
  const derivadosP = Promise.all([mensajesP, supabaseP, tenantP]).then(
    ([lista, supabase, tenant]) =>
      Promise.all([
        resolverCompartidos(
          supabase,
          lista
            .map(compartidoDelMensaje)
            .filter((item): item is EnlaceInterno => item !== null),
          { locale: tenant.locale },
        ),
        leerReaccionesDeMensajes(
          supabase,
          "directo",
          lista.map((message) => message.id),
          userId,
        ),
        firmarAdjuntosDelHilo(
          lista
            .map((message) => message.adjunto?.path)
            .filter(
              (path): path is string => typeof path === "string" && path.length > 0,
            ),
        ),
      ]),
  );

  const delOtroP = supabaseP.then((supabase) =>
    Promise.all([
      other
        ? supabase
            .from("trust_scores")
            .select("score, level, signals")
            .eq("profile_id", other.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // En esta tanda —y no en un efecto del cliente— para que el encabezado se
      // pinte completo de una, sin un "En línea" que aparece tarde.
      leerPresencia(supabase, other ? [other.id] : []),
    ]),
  );

  const [
    messages,
    tenant,
    [compartidos, reaccionesPorMensaje, firmas],
    [{ data: trustRow }, presencias],
    viewerZone,
    formatDate,
    emojiCatalog,
  ] = await Promise.all([mensajesP, tenantP, derivadosP, delOtroP, zonaP, formatoP, emojisP]);

  const trust = toTrustProps(trustRow, other?.identity_verified ?? false);

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
    senderId === userId ? nombrePropio : otherName;

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
      esPropio: original.sender_id === userId,
      resumen: resumenDeMensaje(
        original.kind ?? "texto",
        original.body,
        Boolean(original.deleted_at),
      ),
    };
  };

  const isAccepted = conversation.status === "accepted";
  // Descartada (0177): el creador no se entera y quien la descartó, si llega
  // al hilo por otro lado, todavía puede aceptarla.
  const isPending =
    conversation.status === "pending" || sigueDescartada(conversation.status);
  const isBlocked = conversation.status === "blocked";

  return (
    /**
     * El canal de "está escribiendo…" envuelve la pantalla entera porque sus
     * dos puntas están lejos: el composer, abajo de todo, es quien emite; el
     * encabezado, arriba, es quien lo muestra.
     *
     * Con la conversación sin aceptar la lista va VACÍA y no se abre ningún
     * canal. La policy de la 0148 exige `status = 'accepted'`, así que montarlo
     * igual sería pedir una autorización que la base va a negar.
     */
    <EscribiendoProvider
      miId={userId}
      topicos={isAccepted ? [topicoDeDirecto(conversation.id)] : []}
    >
      <EnVueloSiFalta>
      <div
        className={
          enLlamada
            ? "flex min-h-full flex-col"
            : "flex min-h-[calc(100dvh-10rem)] flex-col"
        }
      >
        <HiloEnVivo
          ambito="directo"
          hiloId={conversation.id}
          miId={userId}
          ultimoCreadoEn={messages.at(-1)?.created_at ?? null}
          marcarLeido={!enLlamada}
        />
        {/* Sin canal todavía (la 0148 lo niega a una pendiente): quien pidió
            el contacto se entera de que lo aceptaron por la notificación. */}
        {isPending && iAmCreator && (
          <RefrescoEnVivo userId={userId} canal="hilo-pendiente" />
        )}

        {/* En la llamada el panel ya dice con quién se habla y el aviso de
          seguridad se lee una vez, en la página: en 380px eran tres franjas
          antes del primer mensaje. */}
        {!enLlamada && (
          <>
            <ThreadHeader
              otherProfile={{
                id: other?.id ?? "",
                displayName: otherName,
                avatarUrl: other?.avatar_url ?? null,
              }}
              trust={trust}
              presencia={
                other
                  ? (presenciaVisible(presencias.get(other.id)) ?? undefined)
                  : undefined
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
          </>
        )}

        {/* El provider envuelve la LISTA y el COMPOSER: quien elige "Responder"
          está en el medio del hilo y quien lo usa está abajo de todo. */}
        <ResponderProvider>
          <div
            className={cn(
              "flex flex-1 flex-col gap-2.5",
              enLlamada ? "px-3 py-4" : "py-5",
            )}
          >
            {messages.length === 0 && isAccepted && (
              <p className="py-8 text-center text-sm text-foreground-muted">
                {COPY.thread.emptyThread}
              </p>
            )}

            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const dayLabel = formatDate(message.created_at);
              const showDay =
                !previous || formatDate(previous.created_at) !== dayLabel;

              const isOwn = message.sender_id === userId;
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
                enlaceInternoDelCuerpo(message.body, { origenesPropios }) !==
                null
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
                <SharedCard
                  compartido={resuelto}
                  kind={compartido.kind}
                  isOwn={isOwn}
                />
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
                    emojiCatalog={emojiCatalog}
                  />
                </div>
              );
            })}

            {messages.length > 0 && (
              <ScrollAnchor
                signature={messages[messages.length - 1].id}
                soloContenedor={enLlamada}
              />
            )}

            <MensajesEnVuelo
              mensajes={messages.map((message) => ({
                id: message.id,
                propio: message.sender_id === userId,
                body: message.body,
                created_at: message.created_at,
              }))}
            />
          </div>

          {/* Pie según estado: solo accepted escribe (§9.2) */}
          {isAccepted && (
            <div
              className={
                enLlamada
                  ? CLASE_PIE_EN_LLAMADA
                  : "sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 -mx-1 bg-canvas/95 px-1 pb-2 pt-1 backdrop-blur-sm"
              }
            >
              <Composer conversationId={conversation.id} refrescarAlEnviar={enLlamada} />
            </div>
          )}
        </ResponderProvider>

        {isPending && !iAmCreator && (
          <div className={enLlamada ? "px-3 pb-3" : "pb-2"}>
            <AcceptBanner
              conversationId={conversation.id}
              otherName={otherFirstName}
              listingTitle={conversation.listing?.title ?? null}
            />
          </div>
        )}

        {isPending && iAmCreator && (
          <Banner
            variant="offline"
            className={cn("mb-2 rounded-lg", enLlamada && "mx-3")}
          >
            {COPY.thread.pendingAsCreator}
          </Banner>
        )}

        {isBlocked && (
          <Banner
            variant="offline"
            className={cn("mb-2 rounded-lg", enLlamada && "mx-3")}
          >
            {COPY.thread.blockedNotice}
          </Banner>
        )}
      </div>
      </EnVueloSiFalta>
    </EscribiendoProvider>
  );
}
