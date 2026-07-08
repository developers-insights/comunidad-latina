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

/**
 * Banner de estado offline — aparece solo sin conexión, con copy cálido.
 *
 * Superficie invertida a propósito (barra oscura en light, clara en dark): una
 * alerta tiene que despegarse del canvas en los dos temas.
 *
 * `cl-print-hide`: en papel esto no significa nada (la hoja no tiene red) y es la
 * única superficie que usa `text-on-surface-inverse`, tinta clara que sin su
 * fondo —que el navegador no imprime— daba 1.08:1. Antes lo escondía el selector
 * `[role="status"]` del @media print, que de paso se llevaba puesta media app.
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="cl-print-hide sticky top-0 z-50 flex items-center justify-center gap-2 bg-surface-inverse px-4 py-2 text-center text-sm text-on-surface-inverse"
    >
      <WifiSlash size={16} aria-hidden />
      <span>{t("common", "offline")}</span>
    </div>
  );
}
