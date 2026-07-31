"use client";

import { useState, useTransition } from "react";
import { BellSlash, DotsThree, Envelope, EnvelopeOpen, Trash } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, useToast } from "@/components/ui";
import {
  CATEGORY_META,
  isAlwaysOnCategory,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import { cn } from "@/lib/utils";
import {
  dismissNotificationAction,
  markNotificationReadAction,
  markNotificationUnreadAction,
  muteCategoryAction,
} from "@/app/(app)/notificaciones/actions";
import { COPY } from "./copy";

export type NotificationMenuProps = {
  notificationId: string;
  category: NotificationCategory;
  read: boolean;
  /** La fila avisa que hay que repintar (o que se descartó, para el deshacer). */
  onChanged: () => void;
  onDismissed: () => void;
};

/**
 * Menú de una notificación. Hoja inferior, igual que el ⋯ del feed: en móvil un
 * popover flotante es imposible de acertar y de cerrar, y esto ya es el
 * vocabulario de la app.
 *
 * "Dejar de recibir avisos de esta categoría" NO aparece en seguridad, pagos y
 * cuenta. No es un interruptor deshabilitado con un cartel —eso se lee como un
 * bug—: sencillamente no está.
 */
export function NotificationMenu({
  notificationId,
  category,
  read,
  onChanged,
  onDismissed,
}: NotificationMenuProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const meta = CATEGORY_META[category];
  const canMute = !isAlwaysOnCategory(category);

  function run(
    action: () => Promise<{ ok: boolean }>,
    after?: () => void,
    success?: { title: string; description?: string },
  ) {
    setOpen(false);
    startTransition(async () => {
      const result = await action().catch(() => ({ ok: false }));
      if (!result.ok) {
        toast({ title: COPY.row.error, variant: "danger" });
        return;
      }
      if (success) toast({ title: success.title, description: success.description });
      after?.();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={COPY.row.menuLabel}
        aria-haspopup="dialog"
        aria-busy={pending || undefined}
        className={cn(
          "flex size-11 shrink-0 items-center justify-center self-center rounded-md",
          "text-foreground-muted transition-[transform,background-color,color]",
          "duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-surface-subtle hover:text-foreground-secondary active:scale-[0.94]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <DotsThree size={22} weight="bold" aria-hidden="true" />
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} ariaLabel={COPY.row.menuLabel}>
        <ul className="flex flex-col pb-4">
          <li>
            {read ? (
              <MenuItem
                icon={<Envelope size={20} />}
                label={COPY.row.markUnread}
                onClick={() => run(() => markNotificationUnreadAction(notificationId), onChanged)}
              />
            ) : (
              <MenuItem
                icon={<EnvelopeOpen size={20} />}
                label={COPY.row.markRead}
                onClick={() => run(() => markNotificationReadAction(notificationId), onChanged)}
              />
            )}
          </li>

          <li>
            <MenuItem
              icon={<Trash size={20} />}
              label={COPY.row.dismiss}
              hint={COPY.row.dismissHint}
              onClick={() => run(() => dismissNotificationAction(notificationId), onDismissed)}
            />
          </li>

          {canMute && (
            <li>
              <MenuItem
                icon={<BellSlash size={20} />}
                label={COPY.row.mute(meta.label)}
                hint={COPY.row.muteHint}
                onClick={() =>
                  run(() => muteCategoryAction(category), onChanged, {
                    title: COPY.row.muteDone(meta.label),
                  })
                }
              />
            </li>
          )}
        </ul>
      </BottomSheet>
    </>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-left",
        "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{label}</span>
        {hint && <span className="block text-xs text-foreground-secondary">{hint}</span>}
      </span>
    </button>
  );
}
