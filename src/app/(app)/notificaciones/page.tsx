import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BellSimple, SlidersHorizontal } from "@phosphor-icons/react/dist/ssr";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/utils";
import { EmptyState, Skeleton, buttonVariants } from "@/components/ui";
import {
  BroadcastCard,
  CategoryTabs,
  CriticalNotification,
  INBOX_PANEL_ID,
  InboxFilters,
  MarkAllRead,
  NotificationItem,
  inboxTabId,
  notificationsCopy as COPY,
  type BroadcastCardData,
  type NotificationItemData,
} from "@/components/notifications";
import {
  CATEGORY_META,
  isNotificationCategory,
  isNotificationPriority,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import {
  inboxHref,
  parseInboxQuery,
  type InboxQuery,
} from "@/lib/notifications/href";
import { groupByRecency } from "@/lib/notifications/recency";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notificaciones" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Cuántas filas trae una pestaña. Con "Anteriores" al fondo y TTL de 60 días,
 *  50 cubre de sobra sin paginar una pantalla que se lee de arriba hacia abajo. */
const PAGE_SIZE = 50;

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
  category: string;
  priority: string;
};

type BroadcastRow = {
  id: string;
  title: string;
  body: string;
  cta_url: string | null;
  starts_at: string;
};

function toItem(row: NotificationRow, now: Date): NotificationItemData {
  return {
    id: row.id,
    kind: row.kind,
    // La base tiene CHECK en las dos columnas, pero llegan como `text`: si
    // mañana se suma un valor y este deploy es viejo, la fila cae en algo
    // conocido en vez de romper el render.
    category: isNotificationCategory(row.category) ? row.category : "social",
    priority: isNotificationPriority(row.priority) ? row.priority : "normal",
    title: row.title,
    body: row.body,
    href: row.href,
    read: row.read_at !== null,
    createdAt: row.created_at,
    timeLabel: timeAgo(new Date(row.created_at), now),
    actionLabel: COPY.actionLabels[row.kind] ?? null,
  };
}

/**
 * /notificaciones — bandeja con pestañas por categoría, filtro y agrupación por
 * tiempo.
 *
 * Lo que decide la forma de esta pantalla:
 *
 * · **La URL es el estado.** Pestaña y filtro son `?c=` y `?f=` (ver
 *   `lib/notifications/href.ts`): Server Component, filtrado en la base con los
 *   índices de 0045, back del navegador que funciona y avisos linkeables.
 *
 * · **Un solo viaje para los contadores.** `notification_counts()` devuelve las
 *   no leídas de las 13 categorías en una query, no una por pestaña. Devuelve
 *   sólo las que tienen algo: la ausencia ES cero.
 *
 * · **`dismissed_at is null` lo pone la app, no la RLS.** La policy a propósito
 *   deja ver las descartadas para que "Deshacer" pueda existir; esconderlas es
 *   trabajo de esta query (y de sus índices parciales).
 *
 * · **Las críticas van arriba de todo**, fuera del orden por fecha y de los
 *   tramos de tiempo.
 */
export default async function NotificacionesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const query = parseInboxQuery(sp);

  const userId = await getAuthUserId();
  if (!userId) redirect("/entrar?next=/notificaciones");

  const supabase = await createClient();
  const { data: countsData } = await supabase.rpc("notification_counts");

  const counts: Partial<Record<NotificationCategory, number>> = {};
  for (const row of countsData ?? []) {
    if (isNotificationCategory(row.category)) counts[row.category] = row.unread;
  }
  const totalUnread = Object.values(counts).reduce((sum, value) => sum + value, 0);

  return (
    <>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {COPY.title}
          </h1>
          <p className="mt-1 text-sm text-foreground-secondary">
            {totalUnread > 0 ? COPY.header.unread(totalUnread) : COPY.header.allRead}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {totalUnread > 0 && <MarkAllRead tab={query.tab} />}
          <Link
            href="/ajustes/notificaciones"
            aria-label={COPY.header.settings}
            className={cn(
              "flex size-11 items-center justify-center rounded-full border border-border-subtle bg-surface",
              "text-foreground-secondary transition-colors duration-(--duration-fast)",
              "hover:bg-surface-hover hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <CategoryTabs
        active={query.tab}
        filter={query.filter}
        counts={counts}
        totalUnread={totalUnread}
      />

      <InboxFilters tab={query.tab} filter={query.filter} />

      <div
        role="tabpanel"
        id={INBOX_PANEL_ID}
        aria-labelledby={inboxTabId(query.tab)}
        tabIndex={0}
        className="focus-visible:outline-none"
      >
        {/* La key remonta el Suspense en cada cambio de pestaña o filtro: vuelve
            el esqueleto en vez de dejar congelada la lista anterior. */}
        <Suspense key={`${query.tab}:${query.filter}`} fallback={<ListSkeleton />}>
          <InboxList query={query} userId={userId} />
        </Suspense>
      </div>
    </>
  );
}

async function InboxList({ query, userId }: { query: InboxQuery; userId: string }) {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  let notificationsQuery = supabase
    .from("notifications")
    .select("id, kind, title, body, href, read_at, created_at, category, priority")
    .is("dismissed_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (query.tab !== "todas") notificationsQuery = notificationsQuery.eq("category", query.tab);
  if (query.filter === "no-leidas") notificationsQuery = notificationsQuery.is("read_at", null);
  if (query.filter === "importantes") {
    notificationsQuery = notificationsQuery.in("priority", ["high", "critical"]);
  }

  // Los broadcasts son la voz de la plataforma, no una notificación personal:
  // se muestran en "Todas" y en "Comunidad Latina". Repetirlos arriba de cada
  // pestaña sería el mismo cartel siete veces.
  const showBroadcasts = query.tab === "todas" || query.tab === "plataforma";

  const [{ data: notificationsData }, { data: broadcastsData }] = await Promise.all([
    notificationsQuery,
    showBroadcasts
      ? supabase
          .from("broadcasts")
          .select("id, title, body, cta_url, starts_at")
          .order("starts_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as BroadcastRow[] }),
  ]);

  const rows = (notificationsData ?? []) as NotificationRow[];
  const broadcasts = (broadcastsData ?? []) as BroadcastRow[];

  let pendingBroadcasts: BroadcastCardData[] = [];
  if (broadcasts.length > 0) {
    // El filtro por dueño NO es redundante con la RLS: `broadcast_receipts` se
    // lee con `profile_id = auth.uid() OR is_global_admin()`, así que sin esto
    // un global_admin se trae los acuses de TODA la comunidad y cualquier
    // broadcast que otro ya cerró le desaparece a él sin haberlo visto.
    const { data: receiptsData } = await supabase
      .from("broadcast_receipts")
      .select("broadcast_id")
      .eq("profile_id", userId)
      .in(
        "broadcast_id",
        broadcasts.map((b) => b.id),
      );
    const seen = new Set((receiptsData ?? []).map((r) => r.broadcast_id));
    pendingBroadcasts = broadcasts
      .filter((b) => !seen.has(b.id))
      .map((b) => ({ id: b.id, title: b.title, body: b.body, ctaUrl: b.cta_url }));
  }

  const now = new Date();
  const items = rows.map((row) => toItem(row, now));

  // Críticas SIN LEER arriba de todo. Una crítica ya leída vuelve a la fila:
  // la persona ya la vio, dejarla fijada para siempre es ruido.
  const critical = items.filter((item) => item.priority === "critical" && !item.read);
  const rest = items.filter((item) => !(item.priority === "critical" && !item.read));
  const groups = groupByRecency(rest, now);

  if (pendingBroadcasts.length === 0 && items.length === 0) {
    return <InboxEmpty query={query} />;
  }

  return (
    <div className="flex flex-col gap-6 pb-2">
      {pendingBroadcasts.length > 0 && (
        <div className="flex flex-col gap-3">
          {pendingBroadcasts.map((broadcast) => (
            <BroadcastCard key={broadcast.id} broadcast={broadcast} />
          ))}
        </div>
      )}

      {critical.length > 0 && (
        <section aria-label={COPY.critical.section}>
          <SectionTitle>{COPY.critical.section}</SectionTitle>
          <div className="flex flex-col gap-3">
            {critical.map((item) => (
              <CriticalNotification key={item.id} notification={item} />
            ))}
          </div>
        </section>
      )}

      {groups.map((group) => (
        <section key={group.bucket} aria-label={COPY.groups[group.bucket]}>
          <SectionTitle>{COPY.groups[group.bucket]}</SectionTitle>
          <ul className="flex flex-col gap-2">
            {group.items.map((item) => (
              <NotificationItem key={item.id} notification={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
      {children}
    </h2>
  );
}

/**
 * Vacío que EXPLICA. Tres situaciones distintas y tres mensajes distintos: no es
 * lo mismo "no te pasó nada todavía" que "filtraste y no quedó nada" — el
 * segundo necesita una salida, y es el enlace para sacar el filtro.
 */
function InboxEmpty({ query }: { query: InboxQuery }) {
  if (query.filter === "no-leidas") {
    return (
      <EmptyState
        icon={<BellSimple />}
        title={COPY.empty.unreadTitle}
        message={COPY.empty.unreadMessage}
        action={<ResetLink tab={query.tab} />}
      />
    );
  }

  if (query.filter === "importantes") {
    return (
      <EmptyState
        icon={<BellSimple />}
        title={COPY.empty.importantTitle}
        message={COPY.empty.importantMessage}
        action={<ResetLink tab={query.tab} />}
      />
    );
  }

  if (query.tab !== "todas") {
    return (
      <EmptyState
        icon={<BellSimple />}
        title={COPY.empty.categoryTitle(CATEGORY_META[query.tab].label)}
        message={COPY.empty.categoryMessage}
        action={<ResetLink tab="todas" />}
      />
    );
  }

  return (
    <EmptyState
      icon={<BellSimple />}
      title={COPY.empty.allTitle}
      message={COPY.empty.allMessage}
      action={
        <Link href="/propiedades" className={buttonVariants({ variant: "secondary", size: "md" })}>
          {COPY.empty.allCta}
        </Link>
      }
    />
  );
}

function ResetLink({ tab }: { tab: InboxQuery["tab"] }) {
  return (
    <Link
      href={inboxHref({ tab, filter: "todas" })}
      className={buttonVariants({ variant: "secondary", size: "md" })}
    >
      {COPY.empty.reset}
    </Link>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 pt-1">
      <Skeleton className="mb-1 h-3 w-16" />
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-3.5"
        >
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="mt-2 h-3.5 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
