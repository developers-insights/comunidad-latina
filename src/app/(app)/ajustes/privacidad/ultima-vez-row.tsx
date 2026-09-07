"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { saveMostrarUltimaVezAction } from "./ultima-vez-actions";
import { ULTIMA_VEZ_COPY as COPY } from "./ultima-vez-copy";

/**
 * Fila "Mostrar cuándo estuviste en línea" de Ajustes › Privacidad.
 *
 * GUARDA SOLA, sin botón "Guardar" — mismo patrón que `TagPolicyRow` y que
 * `PrefRow`: tocar el interruptor ya es la decisión. Si el guardado falla, el
 * control VUELVE a como estaba y avisa: dejarlo apagado en pantalla cuando la
 * base lo tiene prendido le haría creer a alguien que está oculto sin estarlo.
 */
export function UltimaVezRow({ initialMostrar }: { initialMostrar: boolean }) {
  const { toast } = useToast();
  const [mostrar, setMostrar] = useState(initialMostrar);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  function save(next: boolean) {
    if (next === mostrar) return;
    const previous = mostrar;
    setMostrar(next);
    startTransition(async () => {
      const result = await saveMostrarUltimaVezAction(next).catch(() => ({
        ok: false as const,
      }));

      if (!result.ok) {
        setMostrar(previous);
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

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-foreground">{COPY.toggleLabel}</span>
        <button
          type="button"
          role="switch"
          aria-checked={mostrar}
          aria-label={COPY.toggleLabel}
          disabled={pending}
          onClick={() => save(!mostrar)}
          className={cn(
            "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold",
            "transition-[transform,background-color,color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
            "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            "motion-reduce:transition-none motion-reduce:active:scale-100",
            "disabled:opacity-50",
            mostrar
              ? "border-transparent bg-brand-tint text-brand-ink"
              : "border-border-subtle bg-surface text-foreground-muted hover:text-foreground-secondary",
          )}
        >
          {/* El tilde es la señal que NO depende del color (1.4.1): prendido
              tiene ícono, apagado no. El tinte sólo acompaña. */}
          <span aria-hidden="true" className="flex size-4 items-center justify-center">
            {mostrar ? <Check size={14} weight="bold" /> : null}
          </span>
          {mostrar ? COPY.on : COPY.off}
        </button>
      </div>

      {/* La consecuencia, escrita: un interruptor de privacidad que no dice qué
          cambia obliga a probarlo para entenderlo, y probar con esto significa
          exponerse. */}
      <p className="mt-2 text-xs leading-relaxed text-foreground-muted">
        {mostrar ? COPY.hintOn : COPY.hintOff}
      </p>
    </section>
  );
}
