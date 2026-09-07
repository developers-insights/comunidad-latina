import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LockKey } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate, getViewerTimeZone } from "@/lib/time/viewer-zone";
import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE, cn } from "@/lib/utils";
import { Banner } from "@/components/ui";
import { AcceptBanner } from "@/components/messaging/accept-banner";
import { Composer } from "@/components/messaging/composer";
import { COPY } from "@/components/messaging/copy";
import { MessageBubble } from "@/components/messaging/message-bubble";
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

type MessageRow = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  /** 0136. Ausentes en un entorno sin la migración: la fila sigue siendo texto. */
  compartido_kind?: string | null;
  compartido_id?: string | null;
};

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

  const [{ data: trustRow }, { data: messagesData }] = await Promise.all([
    other
      ? supabase
          .from("trust_scores")
          .select("score, level, signals")
          .eq("profile_id", other.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("messages")
      // El VALOR pide las columnas de la 0136 y el TIPO se queda en las que
      // `database.types.ts` ya conoce — mismo `as` que `POST_COLUMNS` en
      // feed/queries.ts, y por el mismo motivo: los tipos se regeneran a mano.
      // La forma real de la fila la fija `MessageRow`.
      .select(
        "id, sender_id, body, created_at, compartido_kind, compartido_id" as "id, sender_id, body, created_at",
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
  const origenesPropios = [
    process.env.NEXT_PUBLIC_SITE_URL ?? "",
    `https://${tenant.slug}.com`,
  ].filter(Boolean);

  const compartidoDelMensaje = (message: MessageRow): EnlaceInterno | null => {
    if (esCompartidoKind(message.compartido_kind) && message.compartido_id) {
      return { kind: message.compartido_kind, id: message.compartido_id };
    }
    return enlaceInternoDelCuerpo(message.body, { origenesPropios });
  };

  const compartidos = await resolverCompartidos(
    supabase,
    messages.map(compartidoDelMensaje).filter((item): item is EnlaceInterno => item !== null),
    { locale: tenant.locale },
  );

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
  const [viewerZone, formatDate] = await Promise.all([
    getViewerTimeZone(),
    getViewerFormatDate(),
  ]);
  const timeFormat = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeStyle: "short",
    timeZone: viewerZone ?? DEFAULT_TIME_ZONE,
  });

  const isAccepted = conversation.status === "accepted";
  const isPending = conversation.status === "pending";
  const isBlocked = conversation.status === "blocked";

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <ThreadRefresh />

      <ThreadHeader
        otherProfile={{
          id: other?.id ?? "",
          displayName: otherName,
          avatarUrl: other?.avatar_url ?? null,
        }}
        trust={trust}
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
          return (
            <div key={message.id} className="flex flex-col gap-2.5">
              {showDay && (
                <p className="py-2 text-center text-xs font-medium text-foreground-muted">
                  {dayLabel}
                </p>
              )}
              {(() => {
                const isOwn = message.sender_id === user.id;
                const compartido = compartidoDelMensaje(message);
                const timeLabel = timeFormat.format(new Date(message.created_at));
                if (!compartido) {
                  return (
                    <MessageBubble body={message.body} isOwn={isOwn} timeLabel={timeLabel} />
                  );
                }
                // La tarjeta va FUERA de la burbuja y no adentro: el ancho de una
                // burbuja está pensado para texto (80% de la columna) y la
                // tarjeta necesita el suyo. Cuando además hay una nota, el texto
                // sigue siendo una burbuja normal arriba — que es como se lee:
                // primero lo que la persona dijo, después lo que mandó.
                return (
                  <div
                    className={cn(
                      "flex flex-col gap-1.5",
                      isOwn ? "items-end" : "items-start",
                    )}
                  >
                    {message.body.trim().length > 0 &&
                      !enlaceInternoDelCuerpo(message.body, { origenesPropios }) && (
                        <MessageBubble body={message.body} isOwn={isOwn} timeLabel="" />
                      )}
                    <div className="w-full max-w-[85%]">
                      <SharedCard
                        compartido={compartidos.get(claveCompartido(compartido)) ?? null}
                        kind={compartido.kind}
                        isOwn={isOwn}
                      />
                      <p
                        className={cn(
                          "mt-1 text-[10px] text-foreground-secondary",
                          isOwn ? "text-right" : "text-left",
                        )}
                      >
                        {timeLabel}
                      </p>
                    </div>
                  </div>
                );
              })()}
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
