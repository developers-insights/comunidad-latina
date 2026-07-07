import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BellSimple } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/utils";
import { EmptyState, buttonVariants } from "@/components/ui";
import {
  BroadcastCard,
  NotificationItem,
  type BroadcastCardData,
  type NotificationItemData,
} from "@/components/notifications";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Notificaciones" };

const COPY = {
  title: "Notificaciones",
  groupToday: "Hoy",
  groupWeek: "Esta semana",
  groupOlder: "Anteriores",
  emptyTitle: "Por ahora, todo tranquilo",
  emptyMessage:
    "Cuando alguien quiera contactarte o te escriba, el aviso te espera acá.",
  emptyCta: "Mirar propiedades",
} as const;

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

type BroadcastRow = {
  id: string;
  title: string;
  body: string;
  cta_url: string | null;
  starts_at: string;
};

type Group = { label: string; items: NotificationItemData[] };

function groupByRecency(rows: NotificationRow[], now: Date): Group[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  const groups: Group[] = [
    { label: COPY.groupToday, items: [] },
    { label: COPY.groupWeek, items: [] },
    { label: COPY.groupOlder, items: [] },
  ];

  for (const row of rows) {
    const created = new Date(row.created_at);
    const item: NotificationItemData = {
      id: row.id,
      title: row.title,
      body: row.body,
      href: row.href,
      read: row.read_at !== null,
      timeLabel: timeAgo(created, now),
    };
    if (created >= startOfToday) groups[0].items.push(item);
    else if (created >= startOfWeek) groups[1].items.push(item);
    else groups[2].items.push(item);
  }

  return groups.filter((group) => group.items.length > 0);
}

/**
 * /notificaciones — bandeja unificada:
 * arriba, broadcasts globales vigentes sin receipt propio (pull §12);
 * abajo, las notificaciones del usuario agrupadas por recencia.
 * RLS hace el trabajo pesado: solo veo MI bandeja y broadcasts de MI tenant.
 */
export default async function NotificacionesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar");

  // Broadcasts: la policy de SELECT ya limita a vigentes (starts/ends) y
  // targeteados a mi tenant — acá solo se filtran los que ya vi (receipt).
  const [{ data: notificationsData }, { data: broadcastsData }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, title, body, href, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("broadcasts")
      .select("id, title, body, cta_url, starts_at")
      .order("starts_at", { ascending: false })
      .limit(10),
  ]);

  const notifications = (notificationsData ?? []) as NotificationRow[];
  const broadcasts = (broadcastsData ?? []) as BroadcastRow[];

  let pendingBroadcasts: BroadcastCardData[] = [];
  if (broadcasts.length > 0) {
    const { data: receiptsData } = await supabase
      .from("broadcast_receipts")
      .select("broadcast_id")
      .in(
        "broadcast_id",
        broadcasts.map((b) => b.id),
      );
    const seen = new Set((receiptsData ?? []).map((r) => r.broadcast_id));
    pendingBroadcasts = broadcasts
      .filter((b) => !seen.has(b.id))
      .map((b) => ({ id: b.id, title: b.title, body: b.body, ctaUrl: b.cta_url }));
  }

  const groups = groupByRecency(notifications, new Date());
  const isEmpty = pendingBroadcasts.length === 0 && notifications.length === 0;

  return (
    <>
      <h1 className="mb-6 font-display text-2xl font-bold tracking-tight text-foreground">
        {t("nav", "notifications")}
      </h1>

      {pendingBroadcasts.length > 0 && (
        <div className="mb-6 flex flex-col gap-3">
          {pendingBroadcasts.map((broadcast) => (
            <BroadcastCard key={broadcast.id} broadcast={broadcast} />
          ))}
        </div>
      )}

      {isEmpty ? (
        <EmptyState
          icon={<BellSimple />}
          title={COPY.emptyTitle}
          message={COPY.emptyMessage}
          action={
            <Link
              href="/propiedades"
              className={buttonVariants({ variant: "secondary", size: "md" })}
            >
              {COPY.emptyCta}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                {group.label}
              </h2>
              <ul className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <NotificationItem key={item.id} notification={item} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
