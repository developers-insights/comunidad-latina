"use client";

import { CaretDown, MapPin } from "@phosphor-icons/react/dist/ssr";
import { useToast } from "@/components/ui";
import { t } from "@/lib/i18n";

const COPY = {
  locationSoonTitle: "Elegir tu zona, muy pronto",
  locationSoonBody:
    "Estamos terminando esta parte — pronto vas a poder elegir la zona que querés ver.",
} as const;

/**
 * Selector de ubicación del header (la campana real vive en
 * components/notifications/NotificationBell). La feature de zona la cablea
 * SOCIAL; mientras tanto, feedback inmediato al toque (patrón AlertButton
 * §5.6) — nunca un botón muerto.
 *
 * En pantallas angostas la etiqueta se colapsa y queda el pin + caret: el
 * header lleva tres controles de 44×44 a la derecha y el nombre del tenant
 * (la zona de marca) tiene prioridad sobre el rótulo de un placeholder.
 * El nombre accesible no depende de la etiqueta visible: va en aria-label.
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
        className="ml-auto flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm text-foreground-secondary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        aria-label={t("nav", "chooseLocation")}
      >
        <MapPin size={20} aria-hidden />
        <span className="hidden max-w-28 truncate sm:inline">
          {t("nav", "locationPlaceholder")}
        </span>
        <CaretDown size={12} aria-hidden />
      </button>
    </>
  );
}
