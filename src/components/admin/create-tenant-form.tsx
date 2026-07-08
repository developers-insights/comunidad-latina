"use client";

import { useActionState, useMemo, useRef, useState, useTransition } from "react";
import { Field, Input } from "@/components/ui";
import { buildBrandScale, BRAND_STEPS } from "@/lib/tenant/brand-pipeline";
import { createTenant, type GlobalActionState } from "@/app/admin/global/actions";
import { ConfirmSlowDialog } from "./confirm-slow-dialog";
import { PendingButton } from "./pending-button";

/**
 * Alta de tenant (panel Global) con preview EN VIVO del pipeline de marca:
 * el hex del admin pasa por buildBrandScale (misma función pura que usa el
 * layout) y se ve la escala tonal + el CTA con contraste AA garantizado antes
 * de crear nada. Confirmación deliberadamente lenta (§4.4): crear una
 * comunidad es un acto fundacional, no un click.
 */

const COPY = {
  legend: "Nueva comunidad",
  intro: "Un hex alcanza: el pipeline genera la marca completa con contraste garantizado.",
  name: "Nombre",
  nameHelp: "Como lo va a ver la comunidad — p. ej. “Colombianos en Miami”.",
  slug: "Slug",
  slugHelp: "Identificador corto, solo minúsculas y guiones. No se cambia después.",
  hex: "Color de marca",
  hexHelp: "El único input de marca. Nunca se usa crudo: pasa por el pipeline.",
  domain: "Dominio",
  domainHelp: "Opcional — p. ej. colombianosmiami.com. Se puede sumar después.",
  city: "Ciudad semilla",
  cityHelp: "Opcional — dónde arranca el contenido inicial.",
  previewTitle: "Así se ve la marca",
  previewCta: "Botón principal",
  submit: "Crear comunidad…",
  confirmTitle: "¿Creamos esta comunidad?",
  confirmDescription:
    "Se crea el tenant con sus módulos activos y su marca. El slug no se puede cambiar después.",
  confirmLabel: "Sí, crear comunidad",
} as const;

const initialState: GlobalActionState = { status: "idle" };

/**
 * Valor por defecto del <input type="color"> — es un DATO (la marca inicial que
 * el admin va a elegir), no un color de UI. Por eso es un hex crudo y no un
 * token: nunca pinta cromo de la app, solo siembra el campo.
 */
const DEFAULT_BRAND_HEX = "#1A5EDB";

export function CreateTenantForm() {
  const [state, formAction, actionPending] = useActionState(createTenant, initialState);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState<{ name: string; slug: string; domain: string }>();

  const [hex, setHex] = useState(DEFAULT_BRAND_HEX);
  const theme = useMemo(() => buildBrandScale(hex), [hex]);

  // Cierra el diálogo cuando la action terminó (éxito o error visible abajo).
  // Ajuste de estado en render — sin setState dentro de effects.
  const [prevState, setPrevState] = useState<GlobalActionState>(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.status !== "idle") setConfirmOpen(false);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setSummary({
      name: String(fd.get("name") ?? ""),
      slug: String(fd.get("slug") ?? ""),
      domain: String(fd.get("domain") ?? "") || "sin dominio propio (por ahora)",
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field htmlFor="tenant-name" label={COPY.name} help={COPY.nameHelp}>
          <Input
            id="tenant-name"
            name="name"
            required
            minLength={3}
            maxLength={60}
            autoComplete="off"
          />
        </Field>
        <Field htmlFor="tenant-slug" label={COPY.slug} help={COPY.slugHelp}>
          <Input
            id="tenant-slug"
            name="slug"
            required
            pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
            minLength={3}
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </div>

      <Field htmlFor="tenant-hex" label={COPY.hex} help={COPY.hexHelp}>
        <div className="flex items-center gap-3">
          <input
            type="color"
            aria-label={COPY.hex}
            value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_BRAND_HEX}
            onChange={(event) => setHex(event.target.value)}
            className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1"
          />
          <Input
            id="tenant-hex"
            name="brandHex"
            required
            pattern="#[0-9a-fA-F]{6}"
            value={hex}
            onChange={(event) => setHex(event.target.value)}
            className="max-w-36 font-mono text-sm"
            spellCheck={false}
          />
        </div>
      </Field>

      {/* Preview en vivo del pipeline de marca */}
      <div className="rounded-lg border border-border bg-surface p-4 shadow-xs">
        <p className="text-xs font-medium text-foreground-muted">{COPY.previewTitle}</p>
        <div className="mt-2 flex overflow-hidden rounded-md" aria-hidden="true">
          {BRAND_STEPS.map((step) => (
            <span
              key={step}
              className="h-8 flex-1"
              style={{ backgroundColor: theme.scale[step] }}
              title={`brand-${step}`}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span
            className="inline-flex h-11 items-center rounded-full px-5 text-sm font-semibold"
            style={{ backgroundColor: theme.brand, color: theme.brandForeground }}
          >
            {COPY.previewCta}
          </span>
          <span className="font-mono text-xs tabular-nums text-foreground-muted">
            {theme.brand}
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field htmlFor="tenant-domain" label={COPY.domain} help={COPY.domainHelp} optional>
          <Input
            id="tenant-domain"
            name="domain"
            inputMode="url"
            placeholder="micomunidad.com"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field htmlFor="tenant-city" label={COPY.city} help={COPY.cityHelp} optional>
          <Input id="tenant-city" name="citySeed" maxLength={80} placeholder="Queens, NY" />
        </Field>
      </div>

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
          <dl className="rounded-md bg-surface-subtle px-3 py-2.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-foreground-muted">Nombre</dt>
              <dd className="font-medium text-foreground">{summary.name}</dd>
            </div>
            <div className="mt-1 flex justify-between gap-3">
              <dt className="text-foreground-muted">Slug</dt>
              <dd className="font-mono text-foreground">{summary.slug}</dd>
            </div>
            <div className="mt-1 flex justify-between gap-3">
              <dt className="text-foreground-muted">Dominio</dt>
              <dd className="break-all text-foreground">{summary.domain}</dd>
            </div>
          </dl>
        )}
      </ConfirmSlowDialog>
    </form>
  );
}
