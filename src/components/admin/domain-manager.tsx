"use client";

import { useActionState, useState, useTransition } from "react";
import { Globe, Star, Warning } from "@phosphor-icons/react/dist/ssr";
import { Badge, Button, Dialog, Field, Input } from "@/components/ui";
import {
  addTenantDomain,
  setDomainStatus,
  setPrimaryDomain,
  type DomainActionState,
} from "@/app/admin/global/dominios/actions";
import {
  DOMAIN_STATUS_COPY,
  DOMAIN_STATUSES,
  isDomainStatus,
  type DomainStatus,
} from "@/app/admin/global/dominios/domain-status";
import { PendingButton } from "./pending-button";

/**
 * Gestión de dominios de una comunidad: alta, principal y ciclo de vida
 * (activar / suspender / archivar).
 *
 * Por qué hay un <Dialog> y no un `confirm()`: suspender un dominio saca el
 * sitio de aire para todo el que entra por esa dirección. Un `confirm()` dice
 * "¿Estás seguro?" y no dice NADA de lo que va a pasar. Acá el diálogo escribe
 * la consecuencia completa (`DOMAIN_STATUS_COPY[...].consequence`) y nombra el
 * dominio, para que la decisión se tome leyendo, no adivinando.
 *
 * El permiso NO está en esta pantalla. Cada acción revalida rol y comunidad en
 * el servidor, y las policies de `tenant_domains` sólo dejan escribir a
 * `global_admin`. Esconder un botón acá no protegería nada; se esconde para no
 * ofrecer lo que no corresponde, no para impedirlo.
 */

const COPY = {
  addLegend: "Sumar un dominio",
  addHelp:
    "Escribilo sin “https://” y sin barras. La dirección se guarda normalizada — mayúsculas, espacios y el punto final se limpian solos.",
  domainLabel: "Dirección",
  notesLabel: "Nota interna",
  notesHelp: "Opcional — para vos y el equipo. Por ejemplo: “vence en marzo”.",
  primaryLabel: "Que sea el dominio principal de esta comunidad",
  addSubmit: "Agregar dominio",
  primaryBadge: "Principal",
  makePrimary: "Hacer principal",
  makePrimaryTitle: "¿Este pasa a ser el dominio principal?",
  makePrimaryConsequence:
    "Es la dirección con la que la comunidad se muestra y se comparte. El que era principal sigue funcionando, pero pasa a ser un alias.",
  makePrimaryConfirm: "Sí, hacerlo principal",
  cancel: "Cancelar",
  suspendedNote: "Esta dirección no está resolviendo: quien la visite no llega a la comunidad.",
} as const;

const initialState: DomainActionState = { status: "idle" };

export interface AdminDomainRow {
  id: string;
  domain: string;
  status: string;
  isPrimary: boolean;
  notes: string | null;
}

/* ------------------------------- Alta ------------------------------------- */

export function DomainAddForm({ tenantId }: { tenantId: string }) {
  const [state, formAction, pending] = useActionState(addTenantDomain, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />

      <Field
        htmlFor={`domain-${tenantId}`}
        label={COPY.domainLabel}
        help={COPY.addHelp}
      >
        <Input
          id={`domain-${tenantId}`}
          name="domain"
          required
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder="micomunidad.com"
          aria-invalid={state.status === "invalid" || undefined}
        />
      </Field>

      <Field
        htmlFor={`notes-${tenantId}`}
        label={COPY.notesLabel}
        help={COPY.notesHelp}
        optional
      >
        <Input id={`notes-${tenantId}`} name="notes" maxLength={300} autoComplete="off" />
      </Field>

      <label className="flex min-h-11 items-center gap-2.5 text-sm text-foreground-secondary">
        <input
          type="checkbox"
          name="isPrimary"
          value="on"
          className="size-4 rounded-sm accent-[var(--color-brand)]"
        />
        {COPY.primaryLabel}
      </label>

      {(state.status === "invalid" || state.status === "error") && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      )}

      <div className="flex justify-end">
        <PendingButton type="submit" variant="secondary" size="sm" loading={pending}>
          {COPY.addSubmit}
        </PendingButton>
      </div>
    </form>
  );
}

/* ------------------------------ Fila del dominio -------------------------- */

export function DomainRow({ domain }: { domain: AdminDomainRow }) {
  const status: DomainStatus = isDomainStatus(domain.status) ? domain.status : "active";
  const statusCopy = DOMAIN_STATUS_COPY[status];

  const [statusState, statusAction, statusPending] = useActionState(setDomainStatus, initialState);
  const [primaryState, primaryAction, primaryPending] = useActionState(
    setPrimaryDomain,
    initialState,
  );
  const [, startTransition] = useTransition();

  /** Qué diálogo está abierto: un estado destino, "primary", o nada. */
  const [dialog, setDialog] = useState<DomainStatus | "primary" | null>(null);

  // Cierre del diálogo cuando la action volvió — ajuste de estado EN RENDER,
  // el patrón que ya usa create-tenant-form (sin cascada de effects).
  const [prevState, setPrevState] = useState<DomainActionState>(statusState);
  if (statusState !== prevState) {
    setPrevState(statusState);
    if (statusState.status !== "idle") setDialog(null);
  }
  const [prevPrimary, setPrevPrimary] = useState<DomainActionState>(primaryState);
  if (primaryState !== prevPrimary) {
    setPrevPrimary(primaryState);
    if (primaryState.status !== "idle") setDialog(null);
  }

  const feedback =
    statusState.status !== "idle"
      ? statusState
      : primaryState.status !== "idle"
        ? primaryState
        : null;

  const submitStatus = (next: DomainStatus) => {
    const fd = new FormData();
    fd.set("domainId", domain.id);
    fd.set("status", next);
    startTransition(() => statusAction(fd));
  };

  const submitPrimary = () => {
    const fd = new FormData();
    fd.set("domainId", domain.id);
    startTransition(() => primaryAction(fd));
  };

  const otherStatuses = DOMAIN_STATUSES.filter((candidate) => candidate !== status);

  return (
    <li className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Globe size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
        <span className="break-all font-mono text-sm text-foreground">{domain.domain}</span>
        {domain.isPrimary && (
          <Badge variant="brand">
            <Star size={12} weight="fill" aria-hidden="true" />
            {COPY.primaryBadge}
          </Badge>
        )}
        <Badge variant={statusCopy.badge}>
          {status !== "active" && <Warning size={12} aria-hidden="true" />}
          {statusCopy.label}
        </Badge>
      </div>

      {domain.notes && (
        <p className="text-xs leading-relaxed text-foreground-muted">{domain.notes}</p>
      )}

      {status === "suspended" && (
        <p className="text-xs leading-relaxed text-warning-ink">{COPY.suspendedNote}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {!domain.isPrimary && status === "active" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDialog("primary")}
            loading={primaryPending}
          >
            {COPY.makePrimary}
          </Button>
        )}
        {otherStatuses.map((next) => (
          <Button
            key={next}
            variant={DOMAIN_STATUS_COPY[next].destructive ? "outline" : "secondary"}
            size="sm"
            onClick={() => setDialog(next)}
            loading={statusPending && dialog === next}
          >
            {DOMAIN_STATUS_COPY[next].action}
          </Button>
        ))}
      </div>

      {feedback && (
        <p
          role={feedback.status === "success" ? "status" : "alert"}
          className={
            feedback.status === "success" ? "text-xs text-success" : "text-xs text-danger"
          }
        >
          {feedback.message}
        </p>
      )}

      {otherStatuses.map((next) => {
        const copy = DOMAIN_STATUS_COPY[next];
        return (
          <Dialog
            key={next}
            open={dialog === next}
            onClose={() => setDialog(null)}
            title={copy.confirmTitle}
            description={domain.domain}
            highRisk={copy.destructive}
            footer={
              <>
                <Button variant="ghost" onClick={() => setDialog(null)} disabled={statusPending}>
                  {COPY.cancel}
                </Button>
                <Button
                  variant={copy.destructive ? "danger" : "primary"}
                  loading={statusPending}
                  onClick={() => submitStatus(next)}
                >
                  {copy.confirmLabel}
                </Button>
              </>
            }
          >
            <p className="text-sm leading-relaxed text-foreground-secondary">{copy.consequence}</p>
            {domain.isPrimary && copy.destructive && (
              <p className="mt-3 rounded-md bg-warning-bg px-3 py-2 text-sm leading-relaxed text-warning-ink">
                Ojo: este es el dominio principal de la comunidad. Si lo apagás, conviene marcar
                otro como principal para que las direcciones que se comparten sigan teniendo
                sentido.
              </p>
            )}
          </Dialog>
        );
      })}

      <Dialog
        open={dialog === "primary"}
        onClose={() => setDialog(null)}
        title={COPY.makePrimaryTitle}
        description={domain.domain}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={primaryPending}>
              {COPY.cancel}
            </Button>
            <Button variant="primary" loading={primaryPending} onClick={submitPrimary}>
              {COPY.makePrimaryConfirm}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-foreground-secondary">
          {COPY.makePrimaryConsequence}
        </p>
      </Dialog>
    </li>
  );
}
