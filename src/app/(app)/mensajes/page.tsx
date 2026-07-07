import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cn, timeAgo } from "@/lib/utils";
import { Avatar, Badge, EmptyState, buttonVariants } from "@/components/ui";
import { ConversationActions } from "@/components/messaging/conversation-actions";
import { COPY } from "@/components/messaging/copy";

export const metadata: Metadata = { title: COPY.inbox.title };

type ProfileLite = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

type ConversationRow = {
  id: string;
  status: string;
  created_at: string;
  created_by: string;
  counterpart_id: string;
  listing: { id: string; title: string; kind: string } | null;
  creator: ProfileLite | null;
  counterpart: ProfileLite | null;
};

type LastMessage = {
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

/**
 * /mensajes — inbox del contacto protegido (§9.2).
 * RLS ya limita a conversaciones donde soy created_by o counterpart;
 * blocked se filtra (ignorar = desaparece sin drama).
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
    .limit(50);

  const conversations = (data ?? []) as unknown as ConversationRow[];

  // Último mensaje por conversación (una sola query, se reduce en memoria).
  const lastByConversation = new Map<string, LastMessage>();
  if (conversations.length > 0) {
    const { data: recentMessages } = await supabase
      .from("messages")
      .select("conversation_id, sender_id, body, created_at")
      .in(
        "conversation_id",
        conversations.map((c) => c.id),
      )
      .order("created_at", { ascending: false })
      .limit(300);
    for (const message of (recentMessages ?? []) as LastMessage[]) {
      if (!lastByConversation.has(message.conversation_id)) {
        lastByConversation.set(message.conversation_id, message);
      }
    }
  }

  // Orden por última actividad (último mensaje o creación de la solicitud).
  const sorted = [...conversations].sort((a, b) => {
    const lastA = lastByConversation.get(a.id)?.created_at ?? a.created_at;
    const lastB = lastByConversation.get(b.id)?.created_at ?? b.created_at;
    return lastB.localeCompare(lastA);
  });

  const now = new Date();

  return (
    <>
      <h1 className="mb-6 font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.inbox.title}
      </h1>

      {sorted.length === 0 ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={COPY.inbox.emptyTitle}
          message={COPY.inbox.emptyMessage}
          action={
            <Link
              href="/propiedades"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {COPY.inbox.emptyAction}
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {sorted.map((conversation) => {
            const iAmCreator = conversation.created_by === user.id;
            const other = iAmCreator ? conversation.counterpart : conversation.creator;
            const otherName = other?.display_name ?? "Miembro de la comunidad";
            const last = lastByConversation.get(conversation.id) ?? null;
            const isPendingReceived = conversation.status === "pending" && !iAmCreator;
            const isPendingSent = conversation.status === "pending" && iAmCreator;

            return (
              <li
                key={conversation.id}
                className={cn(
                  "rounded-lg border bg-surface shadow-xs",
                  isPendingReceived ? "border-brand-200" : "border-border-subtle",
                )}
              >
                <Link
                  href={`/mensajes/${conversation.id}`}
                  className="flex items-start gap-3 rounded-lg p-4 transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]"
                >
                  <Avatar src={other?.avatar_url} name={otherName} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-semibold text-foreground">
                        {otherName}
                      </p>
                      <span className="shrink-0 text-xs text-foreground-muted">
                        {timeAgo(last?.created_at ?? conversation.created_at, now)}
                      </span>
                    </div>

                    {isPendingReceived ? (
                      <p className="mt-0.5 line-clamp-2 text-sm font-medium text-brand-700">
                        {COPY.inbox.wantsToContact(conversation.listing?.title ?? null)}
                      </p>
                    ) : last ? (
                      <p className="mt-0.5 line-clamp-1 text-sm text-foreground-secondary">
                        {last.sender_id === user.id && (
                          <span className="text-foreground-muted">
                            {COPY.inbox.you}{" "}
                          </span>
                        )}
                        {last.body}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-sm text-foreground-muted">
                        {COPY.inbox.noMessagesYet}
                      </p>
                    )}

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {isPendingSent && (
                        <Badge variant="neutral">{COPY.inbox.waitingReply}</Badge>
                      )}
                      {conversation.listing && !isPendingReceived && (
                        <span className="truncate text-xs text-foreground-muted">
                          {COPY.inbox.aboutListing(conversation.listing.title)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>

                {isPendingReceived && (
                  <div className="border-t border-border-subtle px-4 py-3">
                    <ConversationActions conversationId={conversation.id} />
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
