"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle, Scales, Warning } from "@phosphor-icons/react/dist/ssr";
import { Banner, BezelCard, Button, Field, Textarea } from "@/components/ui";
import {
  CLAIM_KIND_OPTIONS,
  CLAIM_TEXT_MAX,
  RECLAMO_COPY,
  type ClaimKind,
} from "@/lib/integrity/disputes";
import { cn } from "@/lib/utils";
import { abrirReclamoDeContenido, type ReclamoState } from "../actions";

/**
 * =============================================================================
 * FORMULARIO DE RECLAMO
 * =============================================================================
 *
 * Un solo form, sin wizard — mismo criterio que el reporte del Escudo: en 375px
 * entra completo y la persona ve TODO lo que va a enviar antes de tocar el único
 * CTA. Un reclamo es una afirmación con consecuencias; partirlo en pasos
 * escondería justo la parte que hay que leer.
 *
 * DOS DECISIONES DE ACCESIBILIDAD QUE NO SON ADORNO:
 *
 *  · El resultado (error o éxito) recibe FOCO. Sin eso, quien navega con lector
 *    de pantalla envía el formulario y no se entera de nada: el mensaje aparece
 *    arriba, fuera de donde está el cursor. El contenedor es `tabIndex={-1}`
 *    —enfocable por código, no por tabulación— y lleva `role="alert"` o
 *    `role="status"` según el caso.
 *  · Los tipos de reclamo son radios REALES dentro de un `fieldset`/`legend`,
 *    con el input en `sr-only` y la tarjeta pintada por `has-[:checked]`. Un div
 *    con `onClick` se vería igual y no sería operable con teclado ni anunciaría
 *    "2 de 5".
 */

const INITIAL_STATE: ReclamoState = { status: "idle" };

const optionCardClass = cn(
  "flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3",
  "transition-[border-color,background-color] duration-(--duration-fast) ease-(--ease-out-premium)",
  "hover:border-border-strong",
  "has-[:checked]:border-brand has-[:checked]:bg-brand-tint",
  "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus-ring",
);

function ReclamoExitoso() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <BezelCard
      variant="success"
      coreClassName="flex flex-col items-center gap-3 px-6 py-8 text-center"
    >
      <div ref={ref} tabIndex={-1} role="status" className="flex flex-col items-center gap-3 outline-none">
        <CheckCircle size={48} weight="fill" aria-hidden="true" className="text-success" />
        <p className="font-display text-xl font-bold text-foreground">
          {RECLAMO_COPY.successTitle}
        </p>
        <p className="max-w-[46ch] text-sm leading-relaxed text-foreground-secondary">
          {RECLAMO_COPY.successBody}
        </p>
      </div>
      <Link
        href="/feed"
        className="mt-2 inline-flex h-11 items-center rounded-md bg-surface-subtle px-5 text-sm font-semibold text-foreground transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        Volver a la comunidad
      </Link>
    </BezelCard>
  );
}

export function ReclamoForm({ assetId }: { assetId: string }) {
  const [state, formAction, pending] = useActionState(abrirReclamoDeContenido, INITIAL_STATE);
  const [kind, setKind] = useState<ClaimKind>(CLAIM_KIND_OPTIONS[0].value);
  const [textLength, setTextLength] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state]);

  if (state.status === "success") return <ReclamoExitoso />;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="assetId" value={assetId} />

      {state.status === "error" && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="outline-none">
          <Banner variant="warning" className="rounded-lg">
            {state.message}
          </Banner>
        </div>
      )}

      {/* ---- 1. De qué se trata -------------------------------------------- */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">
          {RECLAMO_COPY.kindLegend}
        </legend>
        {CLAIM_KIND_OPTIONS.map((option) => (
          <label key={option.value} className={optionCardClass}>
            <input
              type="radio"
              name="claimKind"
              value={option.value}
              checked={kind === option.value}
              onChange={() => setKind(option.value)}
              className="sr-only"
            />
            <Scales
              size={22}
              aria-hidden="true"
              className={cn(
                "mt-0.5 shrink-0",
                kind === option.value ? "text-brand-ink" : "text-foreground-muted",
              )}
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">{option.label}</span>
              <span className="block text-xs leading-relaxed text-foreground-secondary">
                {option.hint}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* ---- 2. El relato --------------------------------------------------- */}
      <Field
        htmlFor="reclamo-texto"
        label={RECLAMO_COPY.claimTextLabel}
        help={RECLAMO_COPY.claimTextHelp}
      >
        <Textarea
          id="reclamo-texto"
          name="claimText"
          rows={5}
          required
          maxLength={CLAIM_TEXT_MAX}
          placeholder={RECLAMO_COPY.claimTextPlaceholder}
          aria-describedby="reclamo-texto-help"
          onChange={(event) => setTextLength(event.currentTarget.value.length)}
        />
        <p className="numeric text-right text-xs text-foreground-muted">
          {textLength}/{CLAIM_TEXT_MAX}
        </p>
      </Field>

      {/* ---- 3. Evidencia --------------------------------------------------- */}
      <Field
        htmlFor="reclamo-evidencia"
        label={RECLAMO_COPY.evidenceLabel}
        help={RECLAMO_COPY.evidenceHelp}
        optional
      >
        <Textarea
          id="reclamo-evidencia"
          name="evidence"
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder={RECLAMO_COPY.evidencePlaceholder}
          aria-describedby="reclamo-evidencia-help"
          className="font-mono text-sm"
        />
      </Field>

      {/* ---- 4. La parte que no se puede suavizar --------------------------- */}
      <section className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Warning size={18} weight="fill" aria-hidden="true" className="shrink-0 text-warning" />
          {RECLAMO_COPY.consequenceTitle}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
          {RECLAMO_COPY.consequenceBody}
        </p>
      </section>

      <label
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3.5",
          "transition-[border-color,background-color] duration-(--duration-fast) ease-(--ease-out-premium)",
          "hover:border-border-strong",
          "has-[:checked]:border-brand has-[:checked]:bg-brand-tint",
          "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus-ring",
        )}
      >
        <input
          type="checkbox"
          name="confirmed"
          value="true"
          required
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-brand"
        />
        <span className="text-sm leading-relaxed text-foreground">
          {RECLAMO_COPY.confirmLabel}
        </span>
      </label>

      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
        {RECLAMO_COPY.submit}
      </Button>
    </form>
  );
}
