"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Field, Input, Textarea } from "@/components/ui";
import { createBroadcast, type GlobalActionState } from "@/app/admin/global/actions";
import { ConfirmSlowDialog } from "./confirm-slow-dialog";
import { PendingButton } from "./pending-button";

/**
 * Compositor de Broadcast Global (§12, modelo pull): título, cuerpo, CTA,
 * vigencia y multi-select de comunidades destino. Confirmación deliberadamente
 * lenta (§4.4): un broadcast le habla a comunidades enteras a la vez.
 */

export interface BroadcastTenantOption {
  id: string;
  name: string;
  slug: string;
}

const COPY = {
  intro:
    "Un mensaje de la plataforma para comunidades enteras (anuncios, emergencias). Se muestra cuando cada persona abre la app — nunca spam push.",
  title: "Título",
  body: "Mensaje",
  bodyHelp: "Claro y humano. Sin jerga técnica — lo lee gente recién llegada.",
  ctaUrl: "Link del botón",
  ctaHelp: "Opcional — a dónde lleva el “Ver más”.",
  startsAt: "Desde",
  startsHelp: "Vacío = ahora mismo.",
  endsAt: "Hasta",
  endsHelp: "Vacío = sin vencimiento.",
  targets: "Comunidades destino",
  targetsHelp: "Elegí al menos una.",
  submit: "Enviar broadcast…",
  confirmTitle: "¿Enviamos este broadcast?",
  confirmDescription:
    "Lo va a ver cada persona de las comunidades elegidas la próxima vez que abra la app.",
  confirmLabel: "Sí, enviar",
  needTargets: "Elegí al menos una comunidad destino.",
  targetCount: (n: number) => (n === 1 ? "1 comunidad elegida" : `${n} comunidades elegidas`),
} as const;

const initialState: GlobalActionState = { status: "idle" };

export function BroadcastForm({ tenants }: { tenants: BroadcastTenantOption[] }) {
  const [state, formAction, actionPending] = useActionState(createBroadcast, initialState);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ title: string; targets: string[] }>();

  // Cierre del diálogo: ajuste de estado en render (sin setState en effects).
  const [prevState, setPrevState] = useState<GlobalActionState>(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.status !== "idle") setConfirmOpen(false);
  }

  // Reset del form (sistema externo → permitido en effect, sin setState).
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClientError(null);
    const fd = new FormData(event.currentTarget);
    const targetIds = fd.getAll("targetIds").map(String);
    if (targetIds.length === 0) {
      setClientError(COPY.needTargets);
      return;
    }
    setSummary({
      title: String(fd.get("title") ?? ""),
      targets: tenants.filter((t) => targetIds.includes(t.id)).map((t) => t.name),
    });
    setConfirmOpen(true);
  }

  function onConfirm() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(() => formAction(fd));
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-foreground-secondary">{COPY.intro}</p>

      <Field htmlFor="bc-title" label={COPY.title}>
        <Input id="bc-title" name="title" required minLength={3} maxLength={120} />
      </Field>

      <Field htmlFor="bc-body" label={COPY.body} help={COPY.bodyHelp}>
        <Textarea id="bc-body" name="body" required minLength={10} maxLength={2000} rows={4} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field htmlFor="bc-cta" label={COPY.ctaUrl} help={COPY.ctaHelp} optional>
          <Input id="bc-cta" name="ctaUrl" type="url" inputMode="url" placeholder="https://…" />
        </Field>
        <Field htmlFor="bc-starts" label={COPY.startsAt} help={COPY.startsHelp} optional>
          <Input id="bc-starts" name="startsAt" type="datetime-local" />
        </Field>
        <Field htmlFor="bc-ends" label={COPY.endsAt} help={COPY.endsHelp} optional>
          <Input id="bc-ends" name="endsAt" type="datetime-local" />
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-foreground">{COPY.targets}</legend>
        <p className="mt-0.5 text-sm text-foreground-muted">{COPY.targetsHelp}</p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {tenants.map((tenant) => (
            <li key={tenant.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
                <input
                  type="checkbox"
                  name="targetIds"
                  value={tenant.id}
                  className="size-5 shrink-0 accent-[var(--color-brand)]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {tenant.name}
                  </span>
                  <span className="block font-mono text-xs text-foreground-muted">
                    {tenant.slug}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {clientError && (
        <p role="alert" className="text-sm text-danger">
          {clientError}
        </p>
      )}
      {state.status === "invalid" || state.status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" && (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      )}

      <div className="flex justify-end">
        <PendingButton type="submit" variant="primary" size="md" loading={actionPending}>
          {COPY.submit}
        </PendingButton>
      </div>

      <ConfirmSlowDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={COPY.confirmTitle}
        description={COPY.confirmDescription}
        confirmLabel={COPY.confirmLabel}
        confirmLoading={actionPending}
        onConfirm={onConfirm}
      >
        {summary && (
          <div className="rounded-md bg-surface-subtle px-3 py-2.5 text-sm">
            <p className="font-medium text-foreground">“{summary.title}”</p>
            <p className="mt-1 text-foreground-secondary">
              {COPY.targetCount(summary.targets.length)}:{" "}
              <span className="text-foreground">{summary.targets.join(", ")}</span>
            </p>
          </div>
        )}
      </ConfirmSlowDialog>
    </form>
  );
}
