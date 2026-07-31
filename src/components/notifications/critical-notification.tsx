"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowCounterClockwise, Warning } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Bubble, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  markNotificationReadAction,
  restoreNotificationAction,
} from "@/app/(app)/notificaciones/actions";
import { COPY } from "./copy";
import type { NotificationItemData } from "./notification-item";
import { NotificationMenu } from "./notification-menu";

/**
 * PRIORIDAD CRÍTICA — una cuenta suspendida, un pago rechazado, una disputa,
 * una alerta de seguridad.
 *
 * TONO (misma decisión que <UrgentBroadcastCard>, y a propósito la misma): el
 * registro es ÁMBAR, el de un cartel de ruta, no rojo de sirena. Rojo a sangre y
 * animación convierten un problema serio en decoración y enseñan a la gente a
 * ignorar el recuadro; la jerarquía la hacen el tamaño, el aire y el doble marco
 * tintado, que ninguna otra fila de la bandeja usa. Distinto ≠ alarmista.
 *
 * Va SIEMPRE arriba de todo, en su propia sección, sin importar la pestaña ni el
 * orden por fecha: si algo le está bloqueando la cuenta a alguien, no puede
 * estar noveno porque llegó el martes.
 */
export function CriticalNotification({
  notification,
}: {
  notification: NotificationItemData;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (dismissed) {
    return (
      <div className="flex min-h-14 items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3">
        <span className="min-w-0 flex-1 text-sm text-foreground-secondary">
          {COPY.row.dismissed}
        </span>
        <button
          type="button"
          aria-busy={pending || undefined}
          onClick={() =>
            startTransition(async () => {
              const result = await restoreNotificationAction(notification.id).catch(() => ({
                ok: false,
              }));
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
    );
  }

  return (
    <BezelCard variant="warning" coreClassName="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-bg text-warning-ink"
        >
          <Warning size={20} weight="fill" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Bubble
              tone="accentSoft"
              accent="var(--color-warning)"
              shape="pill"
              size="sm"
              className="inline-flex max-w-full items-center py-1"
            >
              <span className="truncate text-xs font-semibold uppercase tracking-wide text-warning-ink">
                {COPY.critical.eyebrow}
              </span>
            </Bubble>

            <NotificationMenu
              notificationId={notification.id}
              category={notification.category}
              read={notification.read}
              onChanged={() => router.refresh()}
              onDismissed={() => setDismissed(true)}
            />
          </div>

          <h3 className="mt-2 font-display text-base font-bold leading-snug text-foreground">
            {notification.title}
          </h3>
          {notification.body && (
            <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
              {notification.body}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {notification.href && (
              <Link
                href={notification.href}
                onClick={() => {
                  if (notification.read) return;
                  startTransition(async () => {
                    await markNotificationReadAction(notification.id).catch(() => undefined);
                  });
                }}
                className={cn(buttonVariants({ variant: "primary", size: "md" }), "min-w-0")}
              >
                {notification.actionLabel ?? COPY.row.open}
              </Link>
            )}
            <time
              dateTime={notification.createdAt}
              className="text-xs tabular-nums text-foreground-muted"
            >
              {notification.timeLabel}
            </time>
          </div>
        </div>
      </div>
    </BezelCard>
  );
}
