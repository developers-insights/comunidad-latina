"use client";

import { useActionState, useId, useState } from "react";
import {
  ChatCircleDots,
  CheckCircle,
  Clock,
  Eye,
  EyeSlash,
  MapPin,
  Prohibit,
} from "@phosphor-icons/react/dist/ssr";
import { Badge, Chip, Label, Textarea } from "@/components/ui";
import { formatAdminDateTime } from "@/components/admin/format";
import { PendingButton } from "@/components/admin/pending-button";
import {
  HELP_STATUS_LABEL,
  HELP_TOPIC_LABEL,
  type HelpStatus,
  type HelpTopic,
} from "@/lib/comunidad";
import { NOTA_MAX, NOTA_MIN } from "./decisiones";
import { resolverPedido, type ResolveState } from "./actions";

/**
 * =============================================================================
 * UN PEDIDO, LISTO PARA DECIDIR
 * =============================================================================
 *
 * LA PREGUNTA QUE ESTA TARJETA TIENE QUE CONTESTAR SIN QUE NADIE ABRA OTRA
 * PESTAÑA: ¿esto puede seguir en el tablón?
 *
 * Por eso el bloque grande es el TEXTO COMPLETO del pedido, sin recortar y con
 * los saltos de línea que escribió su autor. Una cola que muestra las primeras
 * dos líneas obliga a abrir cada caso para decidir, y una cola así se resuelve
 * por cansancio.
 *
 * ── LO QUE CAMBIÓ CON LA 0130 ───────────────────────────────────────────────
 * Antes esta tarjeta decidía si algo se PUBLICABA. Ahora el pedido ya está
 * publicado cuando llega acá, así que:
 *  · el contador de respuestas es información nueva y necesaria — ocultar un
 *    pedido con doce respuestas se lleva puesta la conversación entera, y quien
 *    modera tiene que saberlo antes de tocar el botón;
 *  · "hace cuánto espera" pasó a ser "hace cuánto está publicado";
 *  · los botones dicen Ocultar / Volver a publicar, no Aprobar / Rechazar.
 *
 * ── LO QUE ACÁ NO SE VE, Y NO ES UN OLVIDO ──────────────────────────────────
 * Ningún dato de contacto del autor. No existe en esta tabla (§2 de la 0120) y
 * `profiles_private` tiene RLS solo-dueño: ni un global_admin lo lee. Quien
 * modera no necesita el teléfono de nadie para decidir sobre un texto.
 *
 * ── ACCESIBILIDAD ───────────────────────────────────────────────────────────
 *  · Cada estado lleva ícono Y texto: el color nunca es el único portador.
 *  · Los botones son `size="sm"` del design system (h-10) y el motivo es un
 *    `<Textarea>` con `<Label>` real, no un placeholder.
 *  · El resultado de la acción va en `role="status"` / `role="alert"`.
 */

export interface PedidoCardData {
  id: string;
  topic: HelpTopic;
  status: HelpStatus;
  title: string;
  body: string;
  areaLabel: string;
  replyCount: number;
  authorName: string;
  createdAt: string;
  agedDays: number;
  reviewNote: string | null;
  reviewedAt: string | null;
}

const COPY = {
  aged: (days: number) =>
    days <= 0 ? "Se publicó hoy" : days === 1 ? "Hace 1 día" : `Hace ${days} días`,
  author: "Lo escribió",
  respuestas: (cantidad: number) =>
    cantidad === 1 ? "1 respuesta" : `${cantidad} respuestas`,
  noteLabel: "Motivo",
  noteHint: `Se lo mostramos a quien lo escribió, en "Mis pedidos". Obligatorio para ocultar o cerrar (mínimo ${NOTA_MIN} caracteres).`,
  notePlaceholder: "Ej.: el texto pedía dinero, y en esta sección no se mueve plata.",
  previousNote: "Motivo que le dimos",
  reviewedAt: (fecha: string) => `Resuelto el ${fecha}`,
  actions: {
    approved: "Volver a publicar",
    rejected: "Ocultar",
    archived: "Cerrar",
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

const INICIAL: ResolveState = { status: "idle" };

export function PedidoAdminCard({ pedido }: { pedido: PedidoCardData }) {
  const [state, formAction] = useActionState(resolverPedido, INICIAL);
  const [note, setNote] = useState("");
  const noteId = useId();

  const notaLista = note.trim().length >= NOTA_MIN;
  const resuelto = state.status === "success";

  return (
    <article className="rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Chip size="sm" variant="brand">
            {HELP_TOPIC_LABEL[pedido.topic]}
          </Chip>
          {pedido.replyCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary">
              <ChatCircleDots size={14} weight="fill" aria-hidden="true" />
              {COPY.respuestas(pedido.replyCount)}
            </span>
          )}
        </div>
        <Badge variant={BADGE_POR_ESTADO[pedido.status]}>
          {HELP_STATUS_LABEL[pedido.status]}
        </Badge>
      </header>

      <h3 className="mt-2 font-display text-base font-semibold leading-snug text-foreground">
        {pedido.title}
      </h3>

      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground-muted">
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={14} aria-hidden="true" />
          {pedido.areaLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock size={14} aria-hidden="true" />
          {COPY.aged(pedido.agedDays)}
        </span>
        <span>{formatAdminDateTime(pedido.createdAt)}</span>
      </p>

      {/* El texto entero, con los saltos de línea de su autor. Sin `line-clamp`:
          decidir sobre un texto recortado es decidir a ciegas. */}
      <p className="mt-3 whitespace-pre-line rounded-md bg-surface-subtle p-3 text-sm leading-relaxed text-foreground-secondary">
        {pedido.body}
      </p>

      <p className="mt-3 text-sm text-foreground-secondary">
        <span className="font-medium">{COPY.author}: </span>
        {pedido.authorName}
      </p>

      {pedido.reviewNote && (
        <p className="mt-3 rounded-md bg-warning-bg px-3 py-2 text-sm leading-relaxed text-warning-ink">
          <span className="font-semibold">{COPY.previousNote}: </span>
          {pedido.reviewNote}
        </p>
      )}
      {pedido.reviewedAt && (
        <p className="mt-1 text-xs text-foreground-muted">
          {COPY.reviewedAt(formatAdminDateTime(pedido.reviewedAt))}
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
          <input type="hidden" name="pedidoId" value={pedido.id} />

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
            {pedido.status !== "approved" && (
              <PendingButton
                type="submit"
                name="decision"
                value="approved"
                variant="primary"
                size="sm"
              >
                <Eye size={16} weight="fill" aria-hidden="true" />
                {COPY.actions.approved}
              </PendingButton>
            )}

            {(pedido.status === "approved" || pedido.status === "pending") && (
              <PendingButton
                type="submit"
                name="decision"
                value="rejected"
                variant="danger"
                size="sm"
                disabled={!notaLista}
              >
                <EyeSlash size={16} weight="fill" aria-hidden="true" />
                {COPY.actions.rejected}
              </PendingButton>
            )}

            {pedido.status === "approved" && (
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
            )}
          </div>
        </form>
      )}
    </article>
  );
}
