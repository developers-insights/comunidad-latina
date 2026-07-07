"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polling suave (§9.2, R1): refresca el Server Component cada 15s mientras
 * la pestaña está visible. Realtime de Supabase queda para R2.
 */
export function ThreadRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
