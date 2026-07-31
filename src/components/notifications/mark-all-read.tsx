"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Checks } from "@phosphor-icons/react/dist/ssr";
import { useToast } from "@/components/ui";
import { CATEGORY_META } from "@/lib/notifications/categories";
import type { InboxTab } from "@/lib/notifications/href";
import { cn } from "@/lib/utils";
import { markAllNotificationsReadAction } from "@/app/(app)/notificaciones/actions";
import { COPY } from "./copy";

/**
 * "Marcar todas como leídas", con el alcance de la pestaña donde estás.
 *
 * Parado en "Mensajes", el botón dice "Marcar Mensajes como leído" y sólo toca
 * esa categoría: lo contrario —vaciar de un golpe las siete pestañas que no
 * estás mirando— es cómo se pierde una postulación sin haberla visto nunca.
 *
 * En pantallas chicas queda sólo "Marcar leídas": el nombre completo vive en el
 * `aria-label`, así que el lector de pantalla igual escucha el alcance.
 */
export function MarkAllRead({ tab }: { tab: InboxTab }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const label =
    tab === "todas"
      ? COPY.header.markAll
      : COPY.header.markAllInCategory(CATEGORY_META[tab].label);

  return (
    <button
      type="button"
      aria-label={label}
      aria-busy={pending || undefined}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllNotificationsReadAction(tab).catch(() => ({
            ok: false,
          }));
          if (!result.ok) {
            toast({ title: COPY.header.markAllError, variant: "danger" });
            return;
          }
          toast({ title: COPY.header.markAllDone });
          router.refresh();
        })
      }
      className={cn(
        "flex min-h-11 items-center gap-1.5 rounded-full border border-border-subtle px-3.5",
        "bg-surface text-xs font-semibold text-foreground-secondary",
        "transition-[transform,background-color,color] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:bg-surface-hover hover:text-foreground active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:opacity-50",
      )}
    >
      <Checks size={16} aria-hidden="true" />
      <span aria-hidden="true">{COPY.header.markAllShort}</span>
    </button>
  );
}
