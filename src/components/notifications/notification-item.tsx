"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { markNotificationReadAction } from "@/app/(app)/notificaciones/actions";

export type NotificationItemData = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  /** Etiqueta de tiempo ya formateada en el server ("hace 2 horas"). */
  timeLabel: string;
};

/**
 * Fila de notificación: al tocarla se marca leída (server action, idempotente)
 * y navega a su destino. Las no leídas llevan dot de marca + peso tipográfico.
 */
export function NotificationItem({ notification }: { notification: NotificationItemData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      if (!notification.read) {
        // Best-effort: si falla, la navegación sale igual — se reintenta solo
        // la próxima vez que la toque.
        await markNotificationReadAction(notification.id).catch(() => undefined);
      }
      if (notification.href) router.push(notification.href);
    });
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        aria-busy={pending || undefined}
        // `border-brand-subtle` acá es DECORACIÓN (1.59:1 light / 2.07:1 dark contra
        // bg-surface), no la señal de "no leída": esa la dan el punto de abajo y el
        // peso del título. Se queda `-subtle` a propósito. Ojo si algún día se sacan
        // esos dos: el borde solo no alcanza para identificar el estado (1.4.11).
        className={cn(
          "flex w-full min-h-11 items-start gap-3 rounded-lg border px-4 py-3.5 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          notification.read
            ? "border-border-subtle bg-surface hover:bg-surface-subtle"
            : "border-brand-subtle bg-surface shadow-xs hover:bg-surface-subtle",
        )}
      >
        {/* Lo que diferencia es la PRESENCIA del punto, no su tono: `bg-brand` baja
            hasta 2.64:1 contra bg-surface con un tenant de hue claro. El afford que
            no depende del color es el peso del título (semibold vs medium). */}
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            notification.read ? "bg-transparent" : "bg-brand",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                "truncate text-sm text-foreground",
                notification.read ? "font-medium" : "font-semibold",
              )}
            >
              {notification.title}
            </span>
            <span className="shrink-0 text-xs text-foreground-muted">
              {notification.timeLabel}
            </span>
          </span>
          {notification.body && (
            <span className="mt-0.5 block line-clamp-2 text-sm text-foreground-secondary">
              {notification.body}
            </span>
          )}
        </span>
        {notification.href && (
          <CaretRight
            size={16}
            aria-hidden
            className="mt-1 shrink-0 text-foreground-muted"
          />
        )}
      </button>
    </li>
  );
}
