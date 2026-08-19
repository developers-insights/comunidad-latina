"use client";

import { useMemo, useState } from "react";
import { Copy, EnvelopeSimple, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { Field, Textarea, buttonVariants, useToast } from "@/components/ui";
import {
  DEFAULT_TOPIC_ID,
  MESSAGE_MAX,
  SUPPORT_EMAIL,
  SUPPORT_TOPICS,
  buildSupportBody,
  buildSupportMailto,
  buildSupportSubject,
  findTopic,
  type SupportContext,
} from "@/lib/support/contact";
import { cn } from "@/lib/utils";
import { SOPORTE_COPY as COPY } from "./copy";

/**
 * Composer de soporte.
 *
 * ── EL CTA ES UN <a href="mailto:">, NO UN onClick ───────────────────────────
 * Un `window.location.href = "mailto:…"` dentro de un handler lo bloquean
 * varios navegadores móviles cuando el gesto ya se gastó en otra cosa, y además
 * pierde el menú contextual (copiar dirección, abrir en otra app). Un ancla
 * real es la forma que el navegador ya sabe manejar en las tres plataformas.
 * Por eso el href se recalcula en cada tecla: cuando la persona toca, el
 * borrador ya está listo — no hay estado intermedio que sincronizar.
 *
 * ── NUNCA SE BLOQUEA EL BOTÓN ────────────────────────────────────────────────
 * Aunque el mensaje esté vacío, el CTA sigue vivo: quien viene a soporte ya
 * tuvo un problema, y un botón apagado con un cartel de "escribí algo primero"
 * es una segunda pared. Con el asunto solo, el correo igual llega y la
 * conversación arranca.
 *
 * ── LOS CHIPS SON RADIOS DE VERDAD ───────────────────────────────────────────
 * `<input type="radio" class="sr-only">` dentro del label: se navegan con
 * flechas, el lector de pantalla los anuncia como grupo y el foco se ve (el
 * anillo lo pinta el label con `has-[:focus-visible]`). Un `<div onClick>` con
 * pinta de chip no hace nada de eso.
 */
export function SupportComposer({ context }: { context: SupportContext }) {
  const { toast } = useToast();
  const [topicId, setTopicId] = useState<string>(DEFAULT_TOPIC_ID);
  const [message, setMessage] = useState("");

  const topic = findTopic(topicId);
  const href = useMemo(
    () => buildSupportMailto(topicId, message, context),
    [topicId, message, context],
  );

  async function copyToClipboard(value: string, okMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: okMessage, variant: "success" });
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS): no se finge que salió bien.
      toast({ title: COPY.direct.copyFailed, variant: "warning" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Composer ──────────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
        <header className="border-b border-border-subtle bg-surface-subtle px-5 py-4">
          <h2 className="font-display text-base font-bold text-foreground">
            {COPY.compose.title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
            {COPY.compose.body}
          </p>
        </header>

        <div className="flex flex-col gap-5 p-5">
          <fieldset>
            <legend className="mb-2.5 text-sm font-semibold text-foreground">
              {COPY.compose.topicLabel}
            </legend>
            <div className="flex flex-wrap gap-2">
              {SUPPORT_TOPICS.map((option) => (
                <label
                  key={option.id}
                  className={cn(
                    "relative inline-flex min-h-11 cursor-pointer items-center rounded-full px-4 text-sm font-medium",
                    "border border-border-subtle bg-surface text-foreground-secondary",
                    "transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                    "hover:border-border-strong hover:bg-surface-subtle active:scale-[0.97]",
                    "has-[:checked]:border-brand has-[:checked]:bg-brand-tint has-[:checked]:font-semibold has-[:checked]:text-brand-ink",
                    "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus-ring",
                  )}
                >
                  <input
                    type="radio"
                    name="motivo"
                    value={option.id}
                    checked={topicId === option.id}
                    onChange={() => setTopicId(option.id)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <Field
            htmlFor="soporte-mensaje"
            label={COPY.compose.messageLabel}
            help={COPY.compose.messageHelp}
          >
            <Textarea
              id="soporte-mensaje"
              name="mensaje"
              rows={6}
              maxLength={MESSAGE_MAX}
              value={message}
              placeholder={topic.placeholder}
              onChange={(event) => setMessage(event.target.value)}
              aria-describedby="soporte-mensaje-help soporte-mensaje-contador"
            />
          </Field>

          <p
            id="soporte-mensaje-contador"
            aria-live="polite"
            className="-mt-3 text-right text-xs tabular-nums text-foreground-muted"
          >
            {COPY.compose.counter(message.length, MESSAGE_MAX)}
          </p>

          <div className="flex flex-col gap-2">
            <a
              href={href}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
            >
              <PaperPlaneTilt size={18} weight="fill" aria-hidden="true" />
              {COPY.compose.cta}
            </a>
            <p className="text-center text-xs text-foreground-muted">
              {COPY.compose.ctaHint}
            </p>
          </div>
        </div>
      </section>

      {/* ── Salida directa ────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border-subtle bg-surface p-5">
        <h2 className="font-display text-base font-bold text-foreground">
          {COPY.direct.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
          {COPY.direct.body}
        </p>

        <div className="mt-4 flex items-center gap-3 rounded-md border border-border-subtle bg-surface-subtle px-4 py-3">
          <EnvelopeSimple
            size={20}
            aria-hidden="true"
            className="shrink-0 text-foreground-muted"
          />
          {/* `select-all` + `break-all`: en una casilla larga sobre pantalla
              angosta, poder seleccionarla de un toque es la vía de escape final
              si el portapapeles está bloqueado. */}
          <span className="min-w-0 flex-1 select-all break-all text-sm font-medium text-foreground">
            {SUPPORT_EMAIL}
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => void copyToClipboard(SUPPORT_EMAIL, COPY.direct.copied)}
            className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}
          >
            <Copy size={16} aria-hidden="true" />
            {COPY.direct.copy}
          </button>
          {message.trim().length > 0 && (
            <button
              type="button"
              onClick={() =>
                void copyToClipboard(
                  `${buildSupportSubject(topicId)}\n\n${buildSupportBody(message, context)}`,
                  COPY.direct.copiedMessage,
                )
              }
              className={cn(buttonVariants({ variant: "ghost" }), "w-full sm:w-auto")}
            >
              <Copy size={16} aria-hidden="true" />
              {COPY.direct.copyMessage}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
