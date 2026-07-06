"use client";

import { useSyncExternalStore } from "react";
import { WifiSlash } from "@phosphor-icons/react";
import { t } from "@/lib/i18n";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

// Snapshot de servidor = online: evita mismatch de hidratación.
const getSnapshot = () => navigator.onLine;
const getServerSnapshot = () => true;

/** Banner de estado offline — aparece solo sin conexión, con copy cálido. */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-neutral-800 px-4 py-2 text-center text-sm text-neutral-50 dark:bg-neutral-700"
    >
      <WifiSlash size={16} aria-hidden />
      <span>{t("common", "offline")}</span>
    </div>
  );
}
