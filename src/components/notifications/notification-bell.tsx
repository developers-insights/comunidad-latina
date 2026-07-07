"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/client";

const COPY = {
  label: (unread: number) =>
    unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones",
} as const;

/**
 * Campana del header → /notificaciones. El count inicial llega del server
 * (RLS: solo MIS notificaciones sin leer) y se refresca al volver el foco
 * a la pestaña — sin polling, sin realtime: barato y suficiente (§12 pull).
 */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [prevInitial, setPrevInitial] = useState(initialUnread);

  // Si el server re-renderiza el shell con un count nuevo, manda el server
  // (patrón "adjust state during render" — sin efecto, sin render en cascada).
  if (initialUnread !== prevInitial) {
    setPrevInitial(initialUnread);
    setUnread(initialUnread);
  }

  const refresh = useCallback(async () => {
    try {
      const supabase = createClient();
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (!error && typeof count === "number") setUnread(count);
    } catch {
      // Sin red o sin sesión: se mantiene el último count conocido.
    }
  }, []);

  useEffect(() => {
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return (
    <Link
      href="/notificaciones"
      aria-label={COPY.label(unread)}
      className="relative flex size-11 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)] dark:text-neutral-400 dark:hover:bg-neutral-800"
    >
      <Bell size={22} aria-hidden />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold tabular-nums leading-none text-brand-foreground"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
