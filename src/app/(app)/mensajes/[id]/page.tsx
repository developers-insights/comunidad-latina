import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LockKey } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { getViewerFormatDate, getViewerTimeZone } from "@/lib/time/viewer-zone";
import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE } from "@/lib/utils";
import { Banner } from "@/components/ui";
import { AcceptBanner } from "@/components/messaging/accept-banner";
import { Composer } from "@/components/messaging/composer";
import { COPY } from "@/components/messaging/copy";
import { MessageBubble } from "@/components/messaging/message-bubble";
import { ScrollAnchor } from "@/components/messaging/scroll-anchor";
import { ThreadHeader } from "@/components/messaging/thread-header";
import { ThreadListingCard } from "@/components/messaging/thread-listing-card";
import { ThreadRefresh } from "@/components/messaging/thread-refresh";
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
      .select("id, sender_id, body, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);

  const messages = (messagesData ?? []) as MessageRow[];
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
              <MessageBubble
                body={message.body}
                isOwn={message.sender_id === user.id}
                timeLabel={timeFormat.format(new Date(message.created_at))}
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
