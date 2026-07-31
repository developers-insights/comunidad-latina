"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { Select, useToast } from "@/components/ui";
import {
  CATEGORY_META,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import {
  NOTIFICATION_FREQUENCIES,
  type NotificationFrequency,
  type NotificationPref,
} from "@/lib/notifications/prefs";
import { cn } from "@/lib/utils";
import { saveNotificationPrefAction } from "@/app/(app)/notificaciones/actions";
import { CategoryIcon } from "./category-icon";
import { PREFS_COPY } from "./copy";

const FREQUENCY_LABELS: Record<NotificationFrequency, string> = {
  all: PREFS_COPY.frequency.all,
  important: PREFS_COPY.frequency.important,
  digest: PREFS_COPY.frequency.digest,
  off: PREFS_COPY.frequency.off,
};

/**
 * Una categoría configurable.
 *
 * GUARDA SOLA, sin botón "Guardar": son diez categorías con tres controles cada
 * una; pedir una confirmación por cambio convierte un ajuste de treinta segundos
 * en una tarea. El acuse es un "Guardado" discreto al lado del nombre, con
 * `aria-live` para que también se escuche.
 *
 * Si el guardado falla, el control VUELVE a lo que estaba y avisa. Un
 * interruptor que se queda prendido cuando la base dice que no es peor que uno
 * que no se movió: la persona cree que apagó algo que le va a seguir llegando.
 */
export function PrefRow({
  category,
  pref,
}: {
  category: NotificationCategory;
  pref: NotificationPref;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState<NotificationPref>(pref);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const meta = CATEGORY_META[category];

  function save(next: NotificationPref) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await saveNotificationPrefAction({
        category,
        inApp: next.inApp,
        email: next.email,
        // `push` viaja tal como estaba: la columna existe y se preserva, pero
        // todavía no hay claves VAPID, así que la pantalla no la ofrece.
        push: next.push,
        frequency: next.frequency,
      }).catch(() => ({ ok: false as const }));

      if (!result.ok) {
        setValue(previous);
        toast({ title: PREFS_COPY.error, variant: "danger" });
        return;
      }
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2200);
    });
  }

  const silenced = value.frequency === "off";
  const selectId = `pref-frequency-${category}`;

  return (
    <div className="flex flex-col gap-3 px-3 py-4 sm:flex-row sm:items-start sm:gap-4">
      <CategoryIcon category={category} className="hidden sm:flex" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
          <span aria-live="polite" className="text-xs font-medium text-success">
            {saved ? PREFS_COPY.saved : ""}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-foreground-secondary">
          {meta.description}
        </p>

        {!silenced && (
          <div className="mt-3 flex flex-wrap gap-2">
            <ChannelToggle
              label={PREFS_COPY.channels.inApp}
              checked={value.inApp}
              disabled={pending}
              onChange={(checked) => save({ ...value, inApp: checked })}
            />
            <ChannelToggle
              label={PREFS_COPY.channels.email}
              checked={value.email}
              disabled={pending}
              onChange={(checked) => save({ ...value, email: checked })}
            />
          </div>
        )}

        {value.frequency === "digest" && (
          <p className="mt-2 text-xs leading-relaxed text-foreground-muted">
            {PREFS_COPY.frequency.digestNote}
          </p>
        )}
      </div>

      <div className="shrink-0 sm:w-52">
        <label htmlFor={selectId} className="sr-only">
          {`${PREFS_COPY.frequency.label}: ${meta.label}`}
        </label>
        <Select
          id={selectId}
          value={value.frequency}
          disabled={pending}
          onChange={(event) =>
            save({ ...value, frequency: event.target.value as NotificationFrequency })
          }
        >
          {NOTIFICATION_FREQUENCIES.map((frequency) => (
            <option key={frequency} value={frequency}>
              {FREQUENCY_LABELS[frequency]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

/**
 * Canal prendido/apagado. `role="switch"` sobre un botón real: el lector de
 * pantalla anuncia "activado/desactivado" sin que haya que inventar texto, y el
 * teclado lo opera con Espacio como cualquier control nativo.
 */
function ChannelToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold",
        "transition-[transform,background-color,color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:opacity-50",
        checked
          ? "border-transparent bg-brand-tint text-brand-ink"
          : "border-border-subtle bg-surface text-foreground-muted hover:text-foreground-secondary",
      )}
    >
      {/* El tilde es la señal que NO depende del color (1.4.1): prendido tiene
          ícono, apagado no. El tinte sólo acompaña. */}
      <span aria-hidden="true" className={cn("flex size-4 items-center justify-center")}>
        {checked ? <Check size={14} weight="bold" /> : null}
      </span>
      {label}
    </button>
  );
}
