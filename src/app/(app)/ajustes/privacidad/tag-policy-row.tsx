"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { saveTagPolicyAction } from "./tag-policy-actions";
import { TAG_POLICY_COPY as COPY } from "./tag-policy-copy";
import { TAG_POLICIES, type TagPolicy } from "./tag-policy";

/**
 * Fila "Quién puede etiquetarte" de Ajustes › Privacidad.
 *
 * GUARDA SOLA, sin botón "Guardar" — mismo patrón que `PrefRow`
 * (notificaciones): tres opciones, tocar una ya es la decisión. Si el
 * guardado falla, el control VUELVE a la opción anterior y avisa con un
 * toast: dejarlo marcado en la opción nueva sería mentirle a la persona sobre
 * quién puede etiquetarla.
 */
export function TagPolicyRow({ initialPolicy }: { initialPolicy: TagPolicy }) {
  const { toast } = useToast();
  const [policy, setPolicy] = useState<TagPolicy>(initialPolicy);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  function save(next: TagPolicy) {
    if (next === policy) return;
    const previous = policy;
    setPolicy(next);
    startTransition(async () => {
      const result = await saveTagPolicyAction(next).catch(() => ({ ok: false as const }));

      if (!result.ok) {
        setPolicy(previous);
        toast({ title: COPY.error, variant: "danger" });
        return;
      }
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2200);
    });
  }

  return (
    <section className="rounded-xl border border-border-subtle bg-surface p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-base font-bold text-foreground">{COPY.title}</h2>
        <span aria-live="polite" className="text-xs font-medium text-success">
          {saved ? COPY.saved : ""}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>

      <div
        role="radiogroup"
        aria-label={COPY.title}
        className="mt-4 flex flex-col gap-2"
      >
        {TAG_POLICIES.map((option) => (
          <TagPolicyOption
            key={option}
            option={option}
            active={policy === option}
            disabled={pending}
            onSelect={() => save(option)}
          />
        ))}
      </div>
    </section>
  );
}

function TagPolicyOption({
  option,
  active,
  disabled,
  onSelect,
}: {
  option: TagPolicy;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const { label, hint } = COPY.options[option];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 items-start gap-2.5 rounded-lg border p-3.5 text-left",
        "transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.99] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        active
          ? "border-brand bg-brand-tint"
          : "border-border-subtle bg-surface hover:bg-surface-subtle",
      )}
    >
      {/* El tilde es la señal que NO depende del color (1.4.1): marcada tiene
          ícono, sin marcar no. */}
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          active ? "border-brand bg-brand text-brand-foreground" : "border-border-subtle bg-surface",
        )}
      >
        {active ? <Check size={11} weight="bold" /> : null}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block text-sm font-semibold",
            active ? "text-brand-ink" : "text-foreground",
          )}
        >
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-foreground-secondary">
          {hint}
        </span>
      </span>
    </button>
  );
}
