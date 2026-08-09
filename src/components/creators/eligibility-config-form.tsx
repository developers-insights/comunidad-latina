"use client";

import { useActionState, useMemo, useState } from "react";
import { CheckCircle, Info, Warning, WarningOctagon } from "@phosphor-icons/react/dist/ssr";
import { Badge, Input, Label } from "@/components/ui";
import { PendingButton } from "@/components/admin/pending-button";
import {
  THRESHOLD_FIELDS,
  THRESHOLD_GROUPS,
  computeEligibilityImpact,
  type EligibilityConfig,
  type EligibilitySubject,
  type ThresholdField,
} from "@/lib/creators/eligibility";
import { REASON_ADMIN_LABEL } from "@/lib/creators/eligibility-copy";
import {
  updateCreatorEligibilityConfig,
  type CreatorConfigActionState,
} from "@/app/admin/creadores/actions";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * PANEL DE UMBRALES DE CREADOR
 * =============================================================================
 *
 * Un formulario de 13 números y interruptores es fácil de dibujar y muy fácil
 * de arruinar: el admin ve "Seguidores mínimos: 100", escribe 500, guarda, y no
 * tiene manera de saber que acaba de dejar sin trabajo a seis personas que ya
 * estaban aprobadas. Ese guardado a ciegas es el problema real que resuelve
 * esta pantalla, y por eso tiene dos cosas que un CRUD no tiene:
 *
 *  1. CADA UMBRAL SE EXPLICA POR SU EFECTO, no por su nombre. Debajo de
 *     "Vistas acumuladas" no dice "min_views": dice qué le pasa a la gente si
 *     lo subís.
 *
 *  2. EL IMPACTO SE CALCULA MIENTRAS ESCRIBÍS. Cada tecla vuelve a evaluar a
 *     todos los creadores aprobados contra los valores que hay en pantalla, con
 *     el MISMO evaluador que refleja al SQL. No es una estimación: es la cuenta
 *     que va a hacer la base, adelantada.
 *
 * Todo el cálculo es local (los snapshots vienen anónimos del server, ver
 * `admin/creadores/snapshots.ts`): sin viajes de red, sin latencia, y sin que
 * "ver el impacto" sea un botón que nadie toca.
 *
 * PERMISOS: acá no hay ninguno. El rol se verifica en la server action y la RLS
 * lo verifica otra vez en la base. Esconder controles no es seguridad; esta
 * pantalla solo se preocupa de que la decisión sea informada.
 * =============================================================================
 */

const COPY = {
  impactTitle: "Qué pasa si guardás esto",
  impactIntro: (n: number) =>
    n === 1
      ? "Hay 1 creador aprobado en tu comunidad. Así queda con los valores de arriba:"
      : `Hay ${n} creadores aprobados en tu comunidad. Así quedan con los valores de arriba:`,
  impactEmpty:
    "Todavía no hay creadores aprobados, así que no hay a quién dejar fuera. Estos requisitos van a aplicar a la primera solicitud que llegue.",
  eligible: "Siguen cumpliendo",
  excluded: "Quedarían fuera",
  undetermined: "No se puede saber",
  byReasonTitle: "Qué requisito los deja fuera",
  unchanged: "Sin cambios todavía",
  changed: (n: number) => (n === 1 ? "1 cambio sin guardar" : `${n} cambios sin guardar`),
  save: "Guardar requisitos",
  yes: "Sí, exigirlo",
  no: "No exigirlo",
  blindTitle: "Lo que esta pantalla no puede ver",
  worseWarning:
    "Este requisito quedó más exigente que el guardado. Mirá el recuadro de impacto antes de guardar.",
  lastUpdate: (who: string, when: string) => `Última edición: ${who} · ${when}`,
  never: "Todavía nadie tocó estos valores: rigen los que trae el sistema.",
} as const;

export interface EligibilityConfigFormProps {
  /** Lo que hay guardado hoy (o los defaults si el tenant nunca configuró). */
  saved: EligibilityConfig;
  /** Snapshots anónimos de los creadores aprobados, para simular. */
  subjects: EligibilitySubject[];
  /** Dimensiones que el panel no puede medir, con su explicación. */
  blindSpots: string[];
  editorName: string | null;
  updatedAt: string | null;
  locale?: string;
}

const initialState: CreatorConfigActionState = { status: "idle" };

/** ¿El valor nuevo es MÁS exigente que el guardado? */
function isStricter(field: ThresholdField, next: EligibilityConfig, prev: EligibilityConfig): boolean {
  const a = next[field.key];
  const b = prev[field.key];
  if (typeof a === "boolean" && typeof b === "boolean") return a && !b;
  if (typeof a === "number" && typeof b === "number") return a > b;
  return false;
}

export function EligibilityConfigForm({
  saved,
  subjects,
  blindSpots,
  editorName,
  updatedAt,
  locale = "es-US",
}: EligibilityConfigFormProps) {
  const [state, formAction] = useActionState(updateCreatorEligibilityConfig, initialState);
  const [draft, setDraft] = useState<EligibilityConfig>(saved);

  const impact = useMemo(() => computeEligibilityImpact(draft, subjects), [draft, subjects]);
  const changedKeys = useMemo(
    () => THRESHOLD_FIELDS.filter((field) => draft[field.key] !== saved[field.key]),
    [draft, saved],
  );

  const nf = new Intl.NumberFormat(locale);
  const byReason = Object.entries(impact.byReason)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {THRESHOLD_GROUPS.map((group) => {
        const fields = THRESHOLD_FIELDS.filter((field) => field.group === group.key);
        return (
          <section key={group.key} aria-labelledby={`grupo-${group.key}`} className="flex flex-col gap-3">
            <div>
              <h3
                id={`grupo-${group.key}`}
                className="font-display text-lg font-semibold text-foreground"
              >
                {group.title}
              </h3>
              <p className="mt-0.5 text-sm text-foreground-secondary">{group.intro}</p>
            </div>

            <ul className="divide-y divide-border-subtle rounded-lg border border-border bg-surface shadow-xs">
              {fields.map((field) => (
                <li key={field.key}>
                  <ThresholdRow
                    field={field}
                    value={draft[field.key]}
                    stricter={isStricter(field, draft, saved)}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, [field.key]: value }) as EligibilityConfig)
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/* ---------------------------------------------------------------- */}
      {/* El impacto. Va abajo del formulario y ANTES del botón de guardar:  */}
      {/* es lo último que se lee antes de decidir.                          */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-labelledby="impacto"
        aria-live="polite"
        className={cn(
          "rounded-lg border p-4 shadow-xs",
          impact.excluded > 0 ? "border-warning bg-warning-bg/40" : "border-border bg-surface",
        )}
      >
        <h3 id="impacto" className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          {impact.excluded > 0 ? (
            <Warning size={20} weight="fill" aria-hidden="true" className="shrink-0 text-warning-ink" />
          ) : (
            <CheckCircle size={20} weight="fill" aria-hidden="true" className="shrink-0 text-success" />
          )}
          {COPY.impactTitle}
        </h3>

        {impact.total === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">{COPY.impactEmpty}</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-foreground-secondary">{COPY.impactIntro(impact.total)}</p>

            <dl className="mt-3 grid grid-cols-3 gap-3">
              <ImpactCell label={COPY.eligible} value={impact.eligible} tone="ok" nf={nf} />
              <ImpactCell
                label={COPY.excluded}
                value={impact.excluded}
                tone={impact.excluded > 0 ? "alert" : "ok"}
                nf={nf}
              />
              <ImpactCell label={COPY.undetermined} value={impact.undetermined} tone="muted" nf={nf} />
            </dl>

            {byReason.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  {COPY.byReasonTitle}
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {byReason.map(([reason, count]) => (
                    <li key={reason}>
                      <Badge variant="warning">
                        {REASON_ADMIN_LABEL[reason as keyof typeof REASON_ADMIN_LABEL]}
                        <span className="numeric font-bold">{nf.format(count ?? 0)}</span>
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {blindSpots.length > 0 && (
          <div className="mt-4 rounded-md bg-surface-subtle px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              <Info size={14} weight="fill" aria-hidden="true" className="text-info" />
              {COPY.blindTitle}
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {blindSpots.map((note) => (
                <li key={note} className="text-sm leading-relaxed text-foreground-secondary">
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* -------------------------- Guardar ------------------------------ */}
      <div className="flex flex-col gap-2">
        {state.status === "error" && (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}
        {state.status === "success" && (
          <p role="status" className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle size={16} weight="fill" aria-hidden="true" />
            {state.message}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-foreground-muted">
            {changedKeys.length === 0 ? COPY.unchanged : COPY.changed(changedKeys.length)}
            {" · "}
            {updatedAt
              ? COPY.lastUpdate(
                  editorName ?? "alguien del equipo",
                  new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(updatedAt)),
                )
              : COPY.never}
          </p>
          <PendingButton variant="primary" size="md" type="submit" disabled={changedKeys.length === 0}>
            {COPY.save}
          </PendingButton>
        </div>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function ImpactCell({
  label,
  value,
  tone,
  nf,
}: {
  label: string;
  value: number;
  tone: "ok" | "alert" | "muted";
  nf: Intl.NumberFormat;
}) {
  return (
    <div className="rounded-md bg-surface px-3 py-2 shadow-xs">
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-2xl font-bold tabular-nums",
          tone === "alert" ? "text-warning-ink" : tone === "muted" ? "text-foreground-muted" : "text-foreground",
        )}
      >
        {nf.format(value)}
      </dd>
    </div>
  );
}

function ThresholdRow({
  field,
  value,
  stricter,
  onChange,
}: {
  field: ThresholdField;
  value: number | boolean;
  stricter: boolean;
  onChange: (value: number | boolean) => void;
}) {
  const id = `umbral-${field.column}`;
  const describedBy = `${id}-efecto`;

  const stricterBadge = stricter ? (
    <Badge variant="warning" title={COPY.worseWarning}>
      <Warning size={12} weight="fill" aria-hidden="true" />
      Más exigente
    </Badge>
  ) : null;

  const explanation = (
    <>
      <p id={describedBy} className="text-sm leading-relaxed text-foreground-secondary">
        {field.effect}
      </p>
      {field.warning && (
        <p className="flex items-start gap-1.5 rounded-md bg-warning-bg px-2.5 py-2 text-sm leading-relaxed text-warning-ink">
          <WarningOctagon size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          {field.warning}
        </p>
      )}
    </>
  );

  if (field.kind === "number") {
    return (
      <div className="flex flex-col gap-2 px-4 py-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label htmlFor={id}>{field.label}</Label>
          {stricterBadge}
        </div>
        {explanation}
        <div className="flex items-center gap-2">
          <Input
            id={id}
            name={field.column}
            type="number"
            inputMode="numeric"
            min={field.min}
            max={field.max}
            step={1}
            value={String(value)}
            aria-describedby={describedBy}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              onChange(Number.isFinite(parsed) ? parsed : 0);
            }}
            className="w-32 numeric"
          />
          {field.unit && <span className="text-sm text-foreground-muted">{field.unit}</span>}
        </div>
      </div>
    );
  }

  /**
   * Radios y no checkbox: ver el docblock de `toggleSchema` en actions.ts. "No
   * tildado" viaja como campo ausente, y un guardado a medias apagaría
   * requisitos que nadie quiso apagar.
   *
   * `<fieldset>` con `<legend>` visible (patrón de module-toggles): el lector de
   * pantalla anuncia "Identidad verificada — Sí, exigirlo, opción 1 de 2".
   */
  return (
    <fieldset className="flex flex-col gap-2 px-4 py-3.5" aria-describedby={describedBy}>
      <legend className="flex flex-wrap items-baseline gap-2 text-sm font-medium text-foreground">
        {field.label}
        {stricterBadge}
      </legend>
      {explanation}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { value: "si", label: COPY.yes, on: true },
            { value: "no", label: COPY.no, on: false },
          ] as const
        ).map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground-secondary",
                "transition-[border-color,background-color,color] duration-(--duration-fast) ease-(--ease-out-premium)",
                "hover:border-border-strong",
                "has-[:checked]:border-brand has-[:checked]:bg-brand-tint has-[:checked]:font-semibold has-[:checked]:text-brand-ink",
                "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus-ring",
              )}
            >
              <input
                type="radio"
                id={optionId}
                name={field.column}
                value={option.value}
                checked={value === option.on}
                onChange={() => onChange(option.on)}
                className="size-4 shrink-0 accent-[var(--color-brand)]"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
