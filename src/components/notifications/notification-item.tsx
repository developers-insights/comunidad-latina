"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowCounterClockwise, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import type {
  NotificationCategory,
  NotificationPriority,
} from "@/lib/notifications/categories";
import {
  markNotificationReadAction,
  restoreNotificationAction,
} from "@/app/(app)/notificaciones/actions";
import { CategoryIcon } from "./category-icon";
import { COPY } from "./copy";
import { NotificationMenu } from "./notification-menu";

export type NotificationItemData = {
  id: string;
  kind: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  /** ISO, para <time dateTime>. */
  createdAt: string;
  /** Etiqueta de tiempo ya formateada en el server ("hace 2 horas"). */
  timeLabel: string;
  /** Texto del botón de acción; null = la fila entera es la acción. */
  actionLabel: string | null;
};

/**
 * FILA DE NOTIFICACIÓN.
 *
 * Un solo destino por fila: el enlace envuelve TODO el contenido (ícono, título,
 * cuerpo, tiempo y la pastilla de acción). El "botón" de acción es una pastilla
 * dentro del enlace, no un segundo control: dos enlaces al mismo lado le hacen
 * leer dos veces lo mismo a quien usa lector de pantalla, y en móvil compiten
 * por el mismo dedo. El ⋯ sí es un control aparte, y por eso vive FUERA del
 * enlace (HTML no permite anidar interactivos).
 *
 * NO LEÍDA se marca con TRES señales, ninguna dependiente del color: el punto,
 * el peso del título y la superficie elevada (blanca sobre el lienzo crema). Más
 * un `sr-only` que lo dice con palabras.
 */
export function NotificationItem({
  notification,
}: {
  notification: NotificationItemData;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * DESHACER SIN TOAST: el toast del repo no tiene acción, y un "Deshacer" que
   * vive 4 segundos en una esquina es un "Deshacer" que nadie llega a tocar. La
   * fila se convierte en su propio aviso y se queda ahí hasta la próxima carga.
   */
  if (dismissed) {
    return (
      <li>
        <div className="flex min-h-14 items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3">
          <span className="min-w-0 flex-1 text-sm text-foreground-secondary">
            {COPY.row.dismissed}
          </span>
          <button
            type="button"
            aria-busy={pending || undefined}
            onClick={() =>
              startTransition(async () => {
                const result = await restoreNotificationAction(notification.id).catch(
                  () => ({ ok: false }),
                );
                if (result.ok) {
                  setDismissed(false);
                  router.refresh();
                }
              })
            }
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-semibold",
              "text-brand-ink transition-colors duration-(--duration-fast) hover:bg-brand-tint",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            <ArrowCounterClockwise size={16} aria-hidden="true" />
            {COPY.row.undo}
          </button>
        </div>
      </li>
    );
  }

  const surface = notification.read
    ? "border-border-subtle bg-surface/60 hover:bg-surface"
    : "border-brand-subtle bg-surface shadow-xs hover:bg-surface-subtle";

  const content = (
    <>
      <CategoryIcon
        category={notification.category}
        className={notification.read ? undefined : "bg-brand-tint text-brand-ink"}
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              "min-w-0 text-sm leading-snug text-foreground",
              notification.read ? "font-medium" : "font-semibold",
            )}
          >
            {notification.title}
          </span>
          <time
            dateTime={notification.createdAt}
            className="shrink-0 text-xs tabular-nums text-foreground-muted"
          >
            {notification.timeLabel}
          </time>
        </span>

        {notification.body && (
          <span className="mt-0.5 block line-clamp-2 text-sm leading-relaxed text-foreground-secondary">
            {notification.body}
          </span>
        )}

        {notification.actionLabel && notification.href && (
          // Pastilla, no botón: es el afford visual del destino de la fila.
          <span
            className={cn(
              "mt-2.5 inline-flex items-center gap-1 rounded-full px-3 py-1.5",
              "bg-brand-tint text-xs font-semibold text-brand-ink",
            )}
          >
            {notification.actionLabel}
            <CaretRight size={12} weight="bold" aria-hidden="true" />
          </span>
        )}
      </span>

      {!notification.read && (
        <>
          <span
            aria-hidden="true"
            className="mt-1.5 size-2 shrink-0 self-start rounded-full bg-brand"
          />
          <span className="sr-only">{COPY.row.unread}</span>
        </>
      )}
    </>
  );

  const rowClass = cn(
    "flex flex-1 items-start gap-3 rounded-lg border px-3 py-3.5 text-left",
    "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
    surface,
  );

  /** Marcar leída viaja en paralelo: la navegación NO espera a la base. */
  const markRead = () => {
    if (notification.read) return;
    startTransition(async () => {
      await markNotificationReadAction(notification.id).catch(() => undefined);
    });
  };

  return (
    <li className="flex items-stretch gap-1">
      {notification.href ? (
        <Link href={notification.href} onClick={markRead} className={rowClass}>
          {content}
        </Link>
      ) : (
        // Sin destino no hay enlace: un aviso informativo (una campaña que
        // arrancó, un cambio de estado) se marca leído y se queda donde está.
        <button
          type="button"
          onClick={markRead}
          aria-busy={pending || undefined}
          disabled={notification.read}
          className={cn(rowClass, "disabled:cursor-default")}
        >
          {content}
        </button>
      )}

      <NotificationMenu
        notificationId={notification.id}
        category={notification.category}
        read={notification.read}
        onChanged={() => router.refresh()}
        onDismissed={() => setDismissed(true)}
      />
    </li>
  );
}
