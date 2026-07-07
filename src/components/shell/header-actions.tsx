"use client";

import { Bell, CaretDown, MapPin } from "@phosphor-icons/react/dist/ssr";
import { useToast } from "@/components/ui";
import { t } from "@/lib/i18n";

const COPY = {
  locationSoonTitle: "Elegir tu zona, muy pronto",
  locationSoonBody:
    "Estamos terminando esta parte — pronto vas a poder elegir la zona que querés ver.",
  notificationsSoonTitle: "Notificaciones, muy pronto",
  notificationsSoonBody:
    "Estamos terminando esta parte — pronto vas a recibir tus avisos acá.",
} as const;

/**
 * Selector de ubicación + campana de notificaciones del header. Las features
 * reales las cablean SOCIAL y notificaciones; mientras tanto, feedback
 * inmediato al toque (patrón AlertButton §5.6) — nunca un botón muerto.
 */
export function HeaderActions() {
  const { toast } = useToast();

  return (
    <>
      <button
        type="button"
        onClick={() =>
          toast({
            title: COPY.locationSoonTitle,
            description: COPY.locationSoonBody,
          })
        }
        className="ml-auto flex min-h-11 items-center gap-1 rounded-full px-3 text-sm text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)] dark:text-neutral-400 dark:hover:bg-neutral-800"
        aria-label={t("nav", "chooseLocation")}
      >
        <MapPin size={20} aria-hidden />
        <span className="max-w-28 truncate">{t("nav", "locationPlaceholder")}</span>
        <CaretDown size={12} aria-hidden />
      </button>

      <button
        type="button"
        onClick={() =>
          toast({
            title: COPY.notificationsSoonTitle,
            description: COPY.notificationsSoonBody,
          })
        }
        className="flex size-11 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)] dark:text-neutral-400 dark:hover:bg-neutral-800"
        aria-label={t("nav", "notifications")}
      >
        <Bell size={22} aria-hidden />
      </button>
    </>
  );
}
