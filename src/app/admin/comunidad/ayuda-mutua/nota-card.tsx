"use client";

import { useActionState, useId, useState } from "react";
import {
  Buildings,
  CheckCircle,
  Clock,
  HandHeart,
  HandsClapping,
  MapPin,
  Prohibit,
  Translate,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Badge, Chip, Label, Textarea } from "@/components/ui";
import { formatAdminDateTime } from "@/components/admin/format";
import { PendingButton } from "@/components/admin/pending-button";
import {
  HELP_DIRECTION_COPY,
  HELP_STATUS_LABEL,
  HELP_TOPIC_LABEL,
  type HelpDirection,
  type HelpStatus,
  type HelpTopic,
} from "@/lib/comunidad";
import { NOTA_MAX, NOTA_MIN } from "./decisiones";
import { resolverAvisoDeAyuda, type ResolveHelpNoticeState } from "./actions";

/**
 * =============================================================================
 * UN AVISO DE AYUDA MUTUA, LISTO PARA DECIDIR
 * =============================================================================
 *
 * LA PREGUNTA QUE ESTA TARJETA TIENE QUE CONTESTAR SIN QUE NADIE ABRA OTRA
 * PESTAÑA: ¿esto se puede publicar tal como está?
 *
 * Por eso el bloque grande es el TEXTO COMPLETO del aviso, sin recortar y con
 * los saltos de línea que escribió su autor. Una cola que muestra las primeras
 * dos líneas obliga a abrir cada caso para decidir, y una cola así se resuelve
 * por cansancio.
 *
 * Alrededor del texto va lo que cambia el sentido de esas palabras: de qué lado
 * está (se ofrece / pide manos), en qué tema, en qué zona, para qué lugar, y
 * hace cuánto está esperando. Nada más: no hay puntaje de confianza ni
 * historial del autor, porque la decisión es sobre el texto y no sobre la
 * persona.
 *
 * ── LO QUE ACÁ NO SE VE, Y NO ES UN OLVIDO ──────────────────────────────────
 * Ningún dato de contacto del autor. No existe en esta tabla (§2 de la 0120) y
 * `profiles_private` tiene RLS solo-dueño: ni un global_admin lo lee. Quien
 * modera no necesita el teléfono de nadie para decidir si un texto se publica.
 *
 * ── ACCESIBILIDAD ───────────────────────────────────────────────────────────
 *  · Cada estado lleva ícono Y texto: el color nunca es el único portador.
 *  · Los botones son `size="sm"` del design system (h-10) y el motivo es un
 *    `<Textarea>` con `<Label>` real, no un placeholder.
 *  · El resultado de la acción va en `role="status"` / `role="alert"`.
 */

export interface HelpNoticeCardData {
  id: string;
  direction: HelpDirection;
  topic: HelpTopic;
  status: HelpStatus;
  title: string;
  body: string;
  areaLabel: string;
  availability: string | null;
  orgName: string | null;
  languages: string[];
  resourceName: string | null;
  authorName: string;
  createdAt: string;
  waitedDays: number;
  reviewNote: string | null;
  reviewedAt: string | null;
}

const COPY = {
  waiting: (days: number) =>
    days <= 0 ? "Llegó hoy" : days === 1 ? "Espera hace 1 día" : `Espera hace ${days} días`,
  author: "Lo escribió",
  place: "Para",
  when: "Cuándo",
  languages: "Idiomas",
  noteLabel: "Motivo",
  noteHint: `Se lo mostramos a quien lo escribió, junto al botón de corregir. Obligatorio para rechazar o bajar (mínimo ${NOTA_MIN} caracteres).`,
  notePlaceholder: "Ej.: falta decir en qué zona y qué días podés.",
  previousNote: "Motivo que le dimos",
  reviewedAt: (fecha: string) => `Resuelto el ${fecha}`,
  actions: {
    approved: "Publicar",
    rejected: "Rechazar",
    archived: "Bajar del tablón",
  },
} as const;

const BADGE_POR_ESTADO: Record<HelpStatus, "neutral" | "brand" | "success" | "warning" | "danger"> =
  {
    draft: "neutral",
    pending: "warning",
    approved: "success",
    rejected: "danger",
    archived: "neutral",
  };

const INICIAL: ResolveHelpNoticeState = { status: "idle" };

export function NotaCard({ aviso }: { aviso: HelpNoticeCardData }) {
  const [state, formAction] = useActionState(resolverAvisoDeAyuda, INICIAL);
  const [note, setNote] = useState("");
  const noteId = useId();

  const esPedido = aviso.direction === "need";
  const notaLista = note.trim().length >= NOTA_MIN;
  const resuelto = state.status === "success";

  return (
    <article className="rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Chip
            size="sm"
            variant={esPedido ? "brand" : "neutral"}
            icon={
              esPedido ? (
                <HandsClapping size={14} weight="fill" aria-hidden="true" />
              ) : (
                <HandHeart size={14} weight="fill" aria-hidden="true" />
              )
            }
          >
            {HELP_DIRECTION_COPY[aviso.direction].badge}
          </Chip>
          <span className="text-sm text-foreground-muted">{HELP_TOPIC_LABEL[aviso.topic]}</span>
        </div>
        <Badge variant={BADGE_POR_ESTADO[aviso.status]}>{HELP_STATUS_LABEL[aviso.status]}</Badge>
      </header>

      <h3 className="mt-2 font-display text-base font-semibold leading-snug text-foreground">
        {aviso.title}
      </h3>

      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground-muted">
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={14} aria-hidden="true" />
          {aviso.areaLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock size={14} aria-hidden="true" />
          {COPY.waiting(aviso.waitedDays)}
        </span>
        <span>{formatAdminDateTime(aviso.createdAt)}</span>
      </p>

      {/* El texto entero, con los saltos de línea de su autor. Sin `line-clamp`:
          decidir sobre un texto recortado es decidir a ciegas. */}
      <p className="mt-3 whitespace-pre-line rounded-md bg-surface-subtle p-3 text-sm leading-relaxed text-foreground-secondary">
        {aviso.body}
      </p>

      <dl className="mt-3 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
        <Dato label={COPY.author} valor={aviso.authorName} />
        {(aviso.orgName || aviso.resourceName) && (
          <Dato
            label={COPY.place}
            valor={aviso.resourceName ?? aviso.orgName ?? ""}
            icon={<Buildings size={14} weight="fill" aria-hidden="true" />}
          />
        )}
        {aviso.availability && <Dato label={COPY.when} valor={aviso.availability} />}
        {aviso.languages.length > 0 && (
          <Dato
            label={COPY.languages}
            valor={aviso.languages.join(", ")}
            icon={<Translate size={14} aria-hidden="true" />}
          />
        )}
      </dl>

      {aviso.reviewNote && (
        <p className="mt-3 rounded-md bg-warning-bg px-3 py-2 text-sm leading-relaxed text-warning-ink">
          <span className="font-semibold">{COPY.previousNote}: </span>
          {aviso.reviewNote}
        </p>
      )}
      {aviso.reviewedAt && (
        <p className="mt-1 text-xs text-foreground-muted">
          {COPY.reviewedAt(formatAdminDateTime(aviso.reviewedAt))}
        </p>
      )}

      {resuelto ? (
        <p
          role="status"
          className="mt-3 flex items-center gap-1.5 rounded-md bg-success-bg px-3 py-2 text-sm text-success-ink"
        >
          <CheckCircle size={16} weight="fill" aria-hidden="true" />
          {state.message}
        </p>
      ) : (
        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="avisoId" value={aviso.id} />

          <div className="space-y-1.5">
            <Label htmlFor={noteId}>{COPY.noteLabel}</Label>
            <Textarea
              id={noteId}
              name="note"
              rows={2}
              maxLength={NOTA_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={COPY.notePlaceholder}
              aria-describedby={`${noteId}-hint`}
            />
            <p id={`${noteId}-hint`} className="text-xs leading-relaxed text-foreground-muted">
              {COPY.noteHint}
            </p>
          </div>

          {state.status === "error" && (
            <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-ink">
              {state.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {aviso.status !== "approved" && (
              <PendingButton type="submit" name="decision" value="approved" variant="primary" size="sm">
                <CheckCircle size={16} weight="fill" aria-hidden="true" />
                {COPY.actions.approved}
              </PendingButton>
            )}

            {aviso.status === "pending" && (
              <PendingButton
                type="submit"
                name="decision"
                value="rejected"
                variant="danger"
                size="sm"
                disabled={!notaLista}
              >
                <XCircle size={16} weight="fill" aria-hidden="true" />
                {COPY.actions.rejected}
              </PendingButton>
            )}

            {aviso.status === "approved" && (
              <>
                <PendingButton
                  type="submit"
                  name="decision"
                  value="rejected"
                  variant="danger"
                  size="sm"
                  disabled={!notaLista}
                >
                  <XCircle size={16} weight="fill" aria-hidden="true" />
                  {COPY.actions.rejected}
                </PendingButton>
                <PendingButton
                  type="submit"
                  name="decision"
                  value="archived"
                  variant="outline"
                  size="sm"
                  disabled={!notaLista}
                >
                  <Prohibit size={16} aria-hidden="true" />
                  {COPY.actions.archived}
                </PendingButton>
              </>
            )}
          </div>
        </form>
      )}
    </article>
  );
}

function Dato({
  label,
  valor,
  icon,
}: {
  label: string;
  valor: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-1.5">
      {icon && (
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <dt className="inline font-medium text-foreground-secondary">{label}: </dt>
        <dd className="inline text-foreground-secondary">{valor}</dd>
      </div>
    </div>
  );
}
