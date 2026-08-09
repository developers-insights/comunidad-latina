"use client";

import { Check } from "@phosphor-icons/react/dist/ssr";
import { LANGUAGES, LANGUAGES_MAX } from "@/lib/profile/catalogs";
import { cn } from "@/lib/utils";

/**
 * Idiomas que habla la persona. PLURAL — la columna es `text[]` (0062).
 *
 * ── POR QUÉ CHIPS Y NO UN `<select multiple>` ────────────────────────────────
 * En un teléfono, `<select multiple>` es una lista con scroll donde hay que
 * mantener apretado para elegir varios: la mitad de la gente elige uno y cree
 * que terminó. Los chips muestran las trece opciones a la vez, cada una es un
 * objetivo de 44px y el estado se ve sin abrir nada.
 *
 * ── ACCESIBILIDAD ────────────────────────────────────────────────────────────
 * Es un grupo de checkboxes, no un grupo de radios: se puede elegir más de uno.
 * Por eso `role="group"` afuera y `role="checkbox"` + `aria-checked` en cada
 * chip, y el estado NO se comunica sólo por color — el tilde lo dice también.
 */

const COPY = {
  label: "Idiomas que hablás",
  optional: "Opcional",
  help: "Ayuda a que te encuentren quienes hablan lo mismo que vos.",
  full: `Llegaste a ${LANGUAGES_MAX} idiomas. Sacá uno para elegir otro.`,
} as const;

export interface LanguagePickerProps {
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  id?: string;
}

export function LanguagePicker({ value, onChange, disabled, id }: LanguagePickerProps) {
  const chosen = new Set(value);
  const full = value.length >= LANGUAGES_MAX;
  const helpId = `${id ?? "languages"}-help`;

  function toggle(code: string) {
    if (chosen.has(code)) {
      onChange(value.filter((c) => c !== code));
      return;
    }
    if (full) return;
    // Se guarda en el ORDEN DEL CATÁLOGO y no en el de tapeo: así dos personas
    // con los mismos idiomas los muestran igual, y el array es comparable.
    const next = new Set([...value, code]);
    onChange(LANGUAGES.filter((l) => next.has(l.code)).map((l) => l.code));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span id={id} className="text-sm font-medium text-foreground">
          {COPY.label}
        </span>
        <span className="text-xs text-foreground-muted">{COPY.optional}</span>
      </div>

      <div
        role="group"
        aria-labelledby={id}
        aria-describedby={helpId}
        className="flex flex-wrap gap-2"
      >
        {LANGUAGES.map((language) => {
          const selected = chosen.has(language.code);
          return (
            <button
              key={language.code}
              type="button"
              role="checkbox"
              aria-checked={selected}
              disabled={disabled || (full && !selected)}
              onClick={() => toggle(language.code)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium",
                "transition-[border-color,background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                "active:scale-[0.97]",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? "border-brand bg-brand-tint text-brand-ink"
                  : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
              )}
            >
              {selected && <Check size={14} weight="bold" aria-hidden="true" />}
              {language.label}
            </button>
          );
        })}
      </div>

      <p id={helpId} className="text-sm text-foreground-muted">
        {full ? COPY.full : COPY.help}
      </p>
    </div>
  );
}
