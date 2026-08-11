import Link from "next/link";
import { Bell } from "@phosphor-icons/react/dist/ssr";
import { createClient, getAuthUserId } from "@/lib/supabase/server";

const COPY = {
  label: "Notificaciones",
  labelUnread: (count: number) => `Notificaciones, ${count} sin leer`,
} as const;

/** Techo visual del badge: por encima de esto se lee "9+", no el número real. */
const MAX_DISPLAY = 9;

/**
 * Cuántas notificaciones sin leer tiene la sesión actual, para el badge de la
 * campana. Mismo patrón exacto que `InboxList` en `/notificaciones`
 * (`src/app/(app)/notificaciones/page.tsx`): `createClient()` +
 * `.is("dismissed_at", null)` + `.gt("expires_at", nowIso)` + `.is("read_at",
 * null)`. Sin `.eq()` de tenant/perfil a mano — la RLS de `notifications`
 * (0011) ya exige `tenant_id = current_tenant_id() AND profile_id =
 * auth.uid()`, así que agregarlos acá sería un filtro de más, no de menos.
 *
 * `dismissed_at`/`expires_at` importan tanto como `read_at`: sin ellos el
 * badge cuenta algo que la bandeja ya no muestra (mismo bug que documenta
 * `getShellContext` para el punto del bottom nav).
 *
 * Nunca lanza: sin sesión o con la DB caída, la campana se pinta sin badge —
 * un contador roto no puede tumbar el header.
 */
async function getUnreadCount(): Promise<number> {
  const userId = await getAuthUserId();
  if (!userId) return 0;

  try {
    const supabase = await createClient();
    const nowIso = new Date().toISOString();
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("dismissed_at", null)
      .gt("expires_at", nowIso)
      .is("read_at", null);

    if (error || typeof count !== "number") return 0;
    return count;
  } catch {
    return 0;
  }
}

/**
 * Campana del header, entre el selector de zona y Mensajes. Server Component
 * async: el header ya lo es (llama `getShellContext()` para el avatar), así
 * que sumar esta consulta no cambia el modelo de render.
 *
 * El badge es puramente decorativo (`aria-hidden`): el conteo se anuncia una
 * sola vez, en el `aria-label` del link ("Notificaciones, 3 sin leer"), nunca
 * dos veces.
 */
export async function NotificationBell() {
  const unread = await getUnreadCount();
  const hasUnread = unread > 0;
  const display = unread > MAX_DISPLAY ? `${MAX_DISPLAY}+` : String(unread);

  return (
    <Link
      href="/notificaciones"
      aria-label={hasUnread ? COPY.labelUnread(unread) : COPY.label}
      className="relative flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-secondary transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
    >
      <Bell size={24} aria-hidden="true" />
      {hasUnread && (
        <span
          aria-hidden="true"
          className="absolute top-1.5 right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[11px] leading-none font-bold tabular-nums text-on-danger ring-2 ring-surface"
        >
          {display}
        </span>
      )}
    </Link>
  );
}
