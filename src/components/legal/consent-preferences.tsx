"use client";

import { useState } from "react";
import { Check, Lock } from "@phosphor-icons/react/dist/ssr";
import { Button, Dialog } from "@/components/ui";
import {
  CATEGORY_META,
  CONSENT_CATEGORIES,
  GATED_CATEGORIES,
  isActive,
  trackersOf,
  useConsent,
  type ConsentCategory,
  type GatedCategory,
} from "@/lib/consent";
import { cn } from "@/lib/utils";
import { CONSENT_COPY as COPY } from "./consent-copy";

/**
 * Pantalla de preferencias, categoría por categoría.
 *
 * Monta sobre `Dialog`, que ya trae foco atrapado, cierre con Escape, bloqueo
 * del scroll de fondo, portal a <body> y las curvas de animación del sistema.
 * Reusarlo no es pereza: es lo que garantiza que esto se sienta parte de la app
 * y que la accesibilidad no dependa de que este archivo se acuerde de todo.
 *
 * Los cambios se aplican al tocar "Guardar", no al mover cada interruptor: en
 * una pantalla de permisos la persona tiene que poder arrepentirse antes de
 * confirmar.
 */
export function ConsentPreferences({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { grants, save } = useConsent();
  /**
   * Borrador vivo. Vive en el padre porque el pie con los botones es una PROP
   * de `Dialog`, no un hijo del formulario.
   *
   * `null` = "no tocó ningún interruptor". Importa: si arrancara con una copia
   * de `grants`, abrir y guardar sin cambiar nada escribiría una foto vieja de
   * los permisos — la que había cuando se montó el componente, no la de ahora.
   */
  const [draft, setDraft] = useState<Record<GatedCategory, boolean> | null>(null);

  const close = () => {
    setDraft(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={COPY.preferences.title}
      description={COPY.preferences.description}
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {COPY.preferences.cancel}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              save(draft ?? grants);
              close();
            }}
          >
            {COPY.preferences.save}
          </Button>
        </>
      }
    >
      {/* El borrador se reinicia REMONTANDO, no con un efecto: cada apertura
          crea una instancia nueva sembrada con lo que hay guardado. Así, si la
          persona canceló la vez anterior, no le mostramos sus cambios
          descartados como si valieran — y sin cascada de renders. */}
      {open && (
        <CategoryList
          key={String(open)}
          initial={grants}
          onDraftChange={setDraft}
        />
      )}
    </Dialog>
  );
}

/** Lista de categorías con su propio borrador, sembrado al montar. */
function CategoryList({
  initial,
  onDraftChange,
}: {
  initial: Record<GatedCategory, boolean>;
  onDraftChange: (draft: Record<GatedCategory, boolean>) => void;
}) {
  const [draft, setDraft] = useState(initial);

  const update = (category: GatedCategory, next: boolean) => {
    const updated = { ...draft, [category]: next };
    setDraft(updated);
    onDraftChange(updated);
  };

  return (
    <ul className="flex flex-col gap-2">
      {CONSENT_CATEGORIES.map((category) => (
        <CategoryRow
          key={category}
          category={category}
          checked={category === "necesarias" ? true : draft[category]}
          onChange={(next) => update(category as GatedCategory, next)}
        />
      ))}
    </ul>
  );
}

/**
 * Una categoría. Muestra CUÁNTAS cosas guarda de verdad, no una promesa
 * abstracta: "Hoy no usamos ninguna" es información que la persona puede
 * verificar en la política de cookies, y sale del mismo registro que el gate.
 */
function CategoryRow({
  category,
  checked,
  onChange,
}: {
  category: ConsentCategory;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const meta = CATEGORY_META[category];
  const locked = category === "necesarias";
  const live = trackersOf(category).filter(isActive).length;

  return (
    <li className="rounded-lg border border-border-subtle bg-surface-subtle p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{meta.label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground-secondary">
            {meta.summary}
          </p>
          <p className="mt-1 text-[11px] font-medium text-foreground-muted">
            {live === 0 ? COPY.preferences.countNone : COPY.preferences.count(live)}
          </p>
        </div>
        {locked ? (
          <span
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-surface px-3.5 text-xs font-semibold text-foreground-muted"
            /* No es un interruptor apagado: es algo que no se puede apagar.
               Un `switch` deshabilitado invita a intentar tocarlo. */
          >
            <Lock size={14} aria-hidden="true" />
            {COPY.preferences.always}
          </span>
        ) : (
          <Toggle
            label={meta.label}
            checked={checked}
            onChange={onChange}
          />
        )}
      </div>
    </li>
  );
}

/**
 * Mismo lenguaje que el interruptor de las preferencias de notificaciones
 * (`notifications/pref-row.tsx`): píldora de 44px, tilde como señal que NO
 * depende del color (WCAG 1.4.1) y el tinte de marca sólo acompañando.
 */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold",
        "transition-[transform,background-color,color,border-color] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        checked
          ? "border-transparent bg-brand-tint text-brand-ink"
          : "border-border-subtle bg-surface text-foreground-muted hover:text-foreground-secondary",
      )}
    >
      <span aria-hidden="true" className="flex size-4 items-center justify-center">
        {checked ? <Check size={14} weight="bold" /> : null}
      </span>
      {checked ? COPY.preferences.on : COPY.preferences.off}
    </button>
  );
}

/** Las categorías que se pueden tocar, para que los tests no re-deriven la lista. */
export const TOGGLEABLE_CATEGORIES = GATED_CATEGORIES;
