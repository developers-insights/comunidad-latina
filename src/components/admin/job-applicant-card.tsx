"use client";

import { useActionState } from "react";
import { Check, X } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, type BadgeProps } from "@/components/ui";
import {
  resolveJobApplication,
  type JobsActionState,
} from "@/app/admin/empleos/actions";
import type { DisclosedApplication } from "@/app/admin/empleos/policy";
import { PendingButton } from "./pending-button";

/**
 * Una postulación en el panel de Empleos.
 *
 * El componente NO decide qué se ve: recibe la postulación YA filtrada por la
 * política de divulgación (app/admin/empleos/policy.ts). Cuando el aviso es de
 * un miembro, `displayName`, `message` y `answers` llegan vacíos desde el
 * servidor — acá no hay nada que ocultar porque nunca llegó.
 *
 * `canResolve` solo apaga los botones: la autorización real se re-verifica
 * server-side en cada submit.
 */

const COPY = {
  accept: "Aceptar",
  decline: "Rechazar",
  anonymous: "Postulación",
  answersTitle: "Sus respuestas",
  messageTitle: "Su nota",
  // Vocabulario del embudo de 0047. Se mantienen las claves viejas
  // (accepted/declined) porque una fila migrada antes del deploy podría
  // llegar con ellas: mostrar "Contratado" es siempre mejor que la palabra
  // cruda de la base. El panel del staff resuelve en dos pasos, así que
  // reviewing/interview no aparecen acá — los mueve el dueño del aviso.
  statusLabel: {
    submitted: "Sin responder",
    reviewing: "En revisión",
    interview: "Entrevista",
    hired: "Contratado",
    rejected: "No seleccionado",
    closed: "Vacante cerrada",
    accepted: "Contratado",
    declined: "No seleccionado",
  } as Record<string, string>,
  actingNote: "Al responder, le avisamos en nombre del equipo de la comunidad.",
} as const;

const STATUS_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
  submitted: "info",
  reviewing: "info",
  interview: "warning",
  hired: "success",
  rejected: "neutral",
  closed: "neutral",
  accepted: "success",
  declined: "neutral",
};

const initialState: JobsActionState = { status: "idle" };

export interface JobApplicantCardProps {
  application: DisclosedApplication;
  /** true solo en avisos de la plataforma (ver policy.ts). */
  canResolve: boolean;
}

export function JobApplicantCard({ application, canResolve }: JobApplicantCardProps) {
  const [state, formAction] = useActionState(resolveJobApplication, initialState);
  const isPending = application.status === "submitted";

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs">
      <div className="flex items-start gap-3">
        {application.displayName && (
          <Avatar size="md" src={application.avatarUrl} name={application.displayName} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-foreground">
              {application.displayName ?? COPY.anonymous}
            </p>
            <Badge variant={STATUS_VARIANT[application.status] ?? "neutral"} className="shrink-0">
              {COPY.statusLabel[application.status] ?? application.status}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-foreground-muted">{application.createdAtLabel}</p>
        </div>
      </div>

      {application.message && (
        <div>
          <h4 className="mb-1 text-xs font-semibold text-foreground-secondary">
            {COPY.messageTitle}
          </h4>
          <p className="whitespace-pre-line break-words rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-foreground-secondary">
            {application.message}
          </p>
        </div>
      )}

      {application.answers.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold text-foreground-secondary">
            {COPY.answersTitle}
          </h4>
          {/* Pregunta → respuesta como lista de definición: el lector de
              pantalla las lee apareadas. key con índice: dos preguntas pueden
              tener exactamente el mismo texto. */}
          <dl className="flex flex-col gap-2">
            {application.answers.map((answer, index) => (
              <div key={`${index}-${answer.question}`} className="flex flex-col gap-0.5">
                <dt className="text-sm text-foreground-muted">{answer.question}</dt>
                <dd className="text-sm font-semibold text-foreground">{answer.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {state.status === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      )}

      {canResolve && isPending && state.status !== "success" && (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="applicationId" value={application.id} />
          <p className="text-xs text-foreground-muted">{COPY.actingNote}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <PendingButton
              variant="outline"
              size="sm"
              type="submit"
              name="decision"
              value="decline"
              className="border-danger/40 text-danger hover:bg-danger-bg"
            >
              <X size={15} aria-hidden="true" />
              {COPY.decline}
            </PendingButton>
            <PendingButton
              variant="primary"
              size="sm"
              type="submit"
              name="decision"
              value="accept"
            >
              <Check size={15} weight="bold" aria-hidden="true" />
              {COPY.accept}
            </PendingButton>
          </div>
        </form>
      )}
    </li>
  );
}
