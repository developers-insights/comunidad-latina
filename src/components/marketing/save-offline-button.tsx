"use client";

import { useCallback, useSyncExternalStore } from "react";
import { CheckCircle, DownloadSimple } from "@phosphor-icons/react/dist/ssr";
import { Button, useToast } from "@/components/ui";
import { COPY } from "./copy";

const STORAGE_KEY = "cl-guias-offline";

interface OfflineGuide {
  slug: string;
  title: string;
  summary: string | null;
  bodyMd: string;
  savedAt: string;
}

function readStore(): Record<string, OfflineGuide> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, OfflineGuide>)
      : {};
  } catch {
    return {};
  }
}

/* Store externo mínimo sobre localStorage: hidrata sin flash (SSR → false)
   y se mantiene en sync entre pestañas vía el evento `storage`. */
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * "Guardar para leer sin conexión": persiste la guía completa en localStorage
 * de este dispositivo (sin cuenta, sin red) y avisa con un toast.
 */
export function SaveOfflineButton({
  slug,
  title,
  summary,
  bodyMd,
}: {
  slug: string;
  title: string;
  summary: string | null;
  bodyMd: string;
}) {
  const { toast } = useToast();

  const getSnapshot = useCallback(() => Boolean(readStore()[slug]), [slug]);
  const saved = useSyncExternalStore(subscribe, getSnapshot, () => false);

  function handleToggle() {
    try {
      const store = readStore();
      if (store[slug]) {
        delete store[slug];
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        emitChange();
        toast({ title: COPY.guideDetail.removedToast });
        return;
      }
      store[slug] = { slug, title, summary, bodyMd, savedAt: new Date().toISOString() };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      emitChange();
      toast({ title: COPY.guideDetail.savedToast, variant: "success" });
    } catch {
      // localStorage lleno o bloqueado — degradación elegante, nunca romper.
      toast({ title: COPY.guideDetail.saveError, variant: "warning" });
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleToggle} aria-pressed={saved}>
      {saved ? (
        <CheckCircle size={18} weight="fill" className="text-success" aria-hidden="true" />
      ) : (
        <DownloadSimple size={18} aria-hidden="true" />
      )}
      {saved ? COPY.guideDetail.savedOffline : COPY.guideDetail.saveOffline}
    </Button>
  );
}
