"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { FLOW_COPY } from "./flow-copy";

type ActionResult = { ok: true } | { ok: false; error: string; needsAuth?: boolean; stale?: boolean };

export function useContractAction() {
  const router = useRouter();
  const { toast } = useToast();
  const [running, setRunning] = useState<string | null>(null);

  async function run<R extends ActionResult>(
    key: string,
    action: () => Promise<R>,
    options: { success?: string | ((result: Extract<R, { ok: true }>) => string | null); onDone?: (result: Extract<R, { ok: true }>) => void } = {},
  ): Promise<R | null> {
    if (running) return null;
    setRunning(key);
    try {
      const result = await action();
      if (!result.ok) {
        const failure = result as Extract<R, { ok: false }>;
        toast({ variant: "danger", title: failure.error });
        if (failure.needsAuth) router.push(`/entrar?next=${encodeURIComponent(window.location.pathname)}`);
        if (failure.stale) router.refresh();
        return result;
      }
      const ok = result as Extract<R, { ok: true }>;
      const message = typeof options.success === "function" ? options.success(ok) : options.success;
      if (message) toast({ variant: "success", title: message });
      options.onDone?.(ok);
      router.refresh();
      return result;
    } catch (error) {
      console.error("[colaboracion] la acción falló en el cliente", error);
      toast({ variant: "danger", title: FLOW_COPY.generic });
      return null;
    } finally {
      setRunning(null);
    }
  }

  return { run, running };
}
