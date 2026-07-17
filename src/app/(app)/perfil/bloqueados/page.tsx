import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Prohibit } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { Avatar, EmptyState } from "@/components/ui";
import { UnblockButton } from "./unblock-button";

export const metadata: Metadata = { title: "Personas bloqueadas" };

const COPY = {
  title: "Personas bloqueadas",
  hint: "No pueden escribirte y no vas a ver sus publicaciones en tu feed mientras estén acá.",
  emptyTitle: "No bloqueaste a nadie",
  emptyMessage:
    "Cuando bloqueás a alguien desde una conversación, aparece en esta lista — y podés desbloquearlo cuando quieras.",
  fallbackName: "Miembro de la comunidad",
} as const;

type BlockedRow = {
  blocked_id: string;
  created_at: string;
  blocked: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
};

/**
 * /perfil/bloqueados — lista de bloqueos propios (RLS: user_blocks_select
 * solo deja ver blocker_id = auth.uid(), así que la query ya viene filtrada).
 */
export default async function BloqueadosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/perfil/bloqueados");

  const { data } = await supabase
    .from("user_blocks")
    .select(
      `blocked_id, created_at,
       blocked:profiles!user_blocks_blocked_id_fkey(id, display_name, avatar_url)`,
    )
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as BlockedRow[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.hint}</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Prohibit size={32} aria-hidden="true" />}
          title={COPY.emptyTitle}
          message={COPY.emptyMessage}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const name = row.blocked?.display_name ?? COPY.fallbackName;
            return (
              <li
                key={row.blocked_id}
                className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4 shadow-xs"
              >
                <Avatar src={row.blocked?.avatar_url ?? null} name={name} size="md" />
                <p className="min-w-0 flex-1 truncate font-semibold text-foreground">
                  {name}
                </p>
                <UnblockButton profileId={row.blocked_id} name={name} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
