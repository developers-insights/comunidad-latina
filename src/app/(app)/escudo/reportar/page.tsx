import type { Metadata } from "next";
import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { Banner } from "@/components/ui";
import { BackLink } from "@/components/escudo/back-link";
import {
  ReporteForm,
  type ConversationOption,
} from "@/components/escudo/reporte-form";

/**
 * /escudo/reportar — reporte comunitario de estafas (§3.3).
 * Server Component: arma las conversaciones recientes del usuario (con el
 * último mensaje de la contraparte como target real de kind=message) y
 * delega el form al client component. RLS limita todo a lo que el usuario
 * puede ver — acá no hay admin client.
 */

const COPY = {
  back: "Escudo",
  title: "Reportar una estafa",
  lead: "Si algo te dio mala espina o ya te quisieron estafar, contanos. Cada reporte protege a los que vienen detrás.",
  loginNotice:
    "Para reportar necesitás una cuenta — así el equipo puede hacer seguimiento y tu reporte tiene peso.",
  loginCta: "Entrar",
} as const;

export const metadata: Metadata = { title: COPY.title };

type ProfileRef = { id: string; display_name: string } | null;

type ConversationRow = {
  id: string;
  created_by: string;
  counterpart_id: string;
  created_at: string;
  listing: { title: string } | null;
  creator: ProfileRef;
  counterpart: ProfileRef;
};

async function getConversationOptions(): Promise<{
  authenticated: boolean;
  options: ConversationOption[];
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { authenticated: false, options: [] };

  // RLS: solo devuelve conversaciones donde soy participante.
  const { data: rows, error } = await supabase
    .from("conversations")
    .select(
      "id, created_by, counterpart_id, created_at, listing:listings(title), creator:profiles!conversations_created_by_fkey(id, display_name), counterpart:profiles!conversations_counterpart_id_fkey(id, display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !rows) {
    if (error) {
      console.error("[escudo] reporte: no se pudieron leer conversaciones:", error.message);
    }
    return { authenticated: true, options: [] };
  }

  const conversations = rows as unknown as ConversationRow[];
  const conversationIds = conversations.map((row) => row.id);

  // Último mensaje de la contraparte por conversación — es el target real
  // que la RPC report_scam acepta para kind=message.
  const lastByConversation = new Map<string, string>();
  if (conversationIds.length > 0) {
    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, created_at")
      .in("conversation_id", conversationIds)
      .neq("sender_id", user.id)
      .order("created_at", { ascending: false })
      .limit(60);

    if (messagesError) {
      console.error("[escudo] reporte: no se pudieron leer mensajes:", messagesError.message);
    }
    for (const message of messages ?? []) {
      if (!lastByConversation.has(message.conversation_id)) {
        lastByConversation.set(message.conversation_id, message.id);
      }
    }
  }

  const options: ConversationOption[] = conversations.map((row) => {
    const other = row.created_by === user.id ? row.counterpart : row.creator;
    return {
      conversationId: row.id,
      label: other?.display_name ?? "Alguien de la comunidad",
      sublabel:
        row.listing?.title ??
        `Conversación del ${formatDate(row.created_at, { style: "long" })}`,
      messageId: lastByConversation.get(row.id) ?? null,
    };
  });

  return { authenticated: true, options };
}

export default async function ReportarPage() {
  const { authenticated, options } = await getConversationOptions();

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/escudo" label={COPY.back} />

      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="text-sm text-foreground-secondary">{COPY.lead}</p>
      </header>

      {authenticated ? (
        <ReporteForm conversations={options} />
      ) : (
        <Banner
          variant="info"
          action={
            <Link
              href="/entrar"
              className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-info focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
            >
              <SignIn size={16} aria-hidden="true" />
              {COPY.loginCta}
            </Link>
          }
        >
          {COPY.loginNotice}
        </Banner>
      )}
    </div>
  );
}
