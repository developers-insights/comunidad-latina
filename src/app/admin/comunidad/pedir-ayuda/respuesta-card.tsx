"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import { CheckCircle, Clock, Eye, EyeSlash } from "@phosphor-icons/react/dist/ssr";
import { Badge, Label, Textarea } from "@/components/ui";
import { formatAdminDateTime } from "@/components/admin/format";
import { PendingButton } from "@/components/admin/pending-button";
import type { HelpReplyStatus } from "@/lib/comunidad";
import { NOTA_MAX, NOTA_MIN } from "./decisiones";
import { resolverRespuesta, type ResolveState } from "./actions";

/**
 * =============================================================================
 * UNA RESPUESTA, LISTA PARA DECIDIR
 * =============================================================================
 *
 * LA PREGUNTA: ¿esta respuesta ayuda o está usando el pedido de alguien para
 * otra cosa?
 *
 * ── EL TÍTULO DEL PEDIDO NO ES DECORACIÓN ───────────────────────────────────
 * Una respuesta fuera de contexto no se puede moderar. "Probá en la 82 con
 * Roosevelt, preguntá por Ana" es un dato buenísimo debajo de "¿dónde consigo
 * una silla de ruedas?" y es una señal rara debajo de "necesito trabajo". Por
 * eso el pedido va ARRIBA de la respuesta y con enlace a la pantalla pública:
 * el hilo entero está a un toque.
 *
 * ── EL MOTIVO ACÁ ES INTERNO ────────────────────────────────────────────────
 * A diferencia del motivo de un pedido —que su autor lee en "Mis pedidos"—
 * éste no se le muestra a nadie. Una respuesta ocultada no tiene camino de
 * corrección (no se edita ni se reenvía), así que mostrarle el reproche a quien
 * la escribió sería sólo un reproche. Se pide igual, para que la decisión quede
 * explicada de cara al equipo.
 *
 * ── LO QUE PASA CON EL CONTADOR ─────────────────────────────────────────────
 * Ocultar resta del `reply_count` del pedido y restaurar suma. Lo hace el
 * trigger de la 0130, no esta pantalla: si el número se mantuviera, el tablón
 * anunciaría respuestas que la moderación ya bajó.
 */

export interface RespuestaCardData {
  id: string;
  noticeId: string;
  noticeTitle: string;
  body: string;
  status: HelpReplyStatus;
  authorName: string;
  createdAt: string;
  agedDays: number;
}

const COPY = {
  enPedido: "En el pedido",
  aged: (days: number) =>
    days <= 0 ? "Hoy" : days === 1 ? "Hace 1 día" : `Hace ${days} días`,
  author: "La escribió",
  estado: { visible: "Se ve", hidden: "Oculta", deleted: "La borró su autor" },
  noteLabel: "Motivo (interno)",
  noteHint: `Queda para el equipo: a quien la escribió no se le muestra. Obligatorio para ocultar (mínimo ${NOTA_MIN} caracteres).`,
  notePlaceholder: "Ej.: está ofreciendo un servicio pago, no ayudando.",
  actions: { hidden: "Ocultar", visible: "Volver a mostrar" },
} as const;

const BADGE_POR_ESTADO: Record<HelpReplyStatus, "success" | "danger" | "neutral"> = {
  visible: "success",
  hidden: "danger",
  deleted: "neutral",
};

const INICIAL: ResolveState = { status: "idle" };

export function RespuestaAdminCard({ respuesta }: { respuesta: RespuestaCardData }) {
  const [state, formAction] = useActionState(resolverRespuesta, INICIAL);
  const [note, setNote] = useState("");
  const noteId = useId();

  const notaLista = note.trim().length >= NOTA_MIN;
  const resuelto = state.status === "success";

  return (
    <article className="rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm text-foreground-muted">
          <span className="font-medium text-foreground-secondary">{COPY.enPedido}: </span>
          <Link
            href={`/comunidad/pedir-ayuda/${respuesta.noticeId}`}
            className="font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            {respuesta.noticeTitle}
          </Link>
        </p>
        <Badge variant={BADGE_POR_ESTADO[respuesta.status]}>
          {COPY.estado[respuesta.status]}
        </Badge>
      </header>

      <p className="mt-3 whitespace-pre-line rounded-md bg-surface-subtle p-3 text-sm leading-relaxed text-foreground-secondary">
        {respuesta.body}
      </p>

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground-muted">
        <span>
          <span className="font-medium text-foreground-secondary">{COPY.author}: </span>
          {respuesta.authorName}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock size={14} aria-hidden="true" />
          {COPY.aged(respuesta.agedDays)}
        </span>
        <span>{formatAdminDateTime(respuesta.createdAt)}</span>
      </p>

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
          <input type="hidden" name="respuestaId" value={respuesta.id} />

          {respuesta.status === "visible" && (
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
          )}

          {state.status === "error" && (
            <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-ink">
              {state.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {respuesta.status === "visible" ? (
              <PendingButton
                type="submit"
                name="decision"
                value="hidden"
                variant="danger"
                size="sm"
                disabled={!notaLista}
              >
                <EyeSlash size={16} weight="fill" aria-hidden="true" />
                {COPY.actions.hidden}
              </PendingButton>
            ) : (
              <PendingButton
                type="submit"
                name="decision"
                value="visible"
                variant="primary"
                size="sm"
              >
                <Eye size={16} weight="fill" aria-hidden="true" />
                {COPY.actions.visible}
              </PendingButton>
            )}
          </div>
        </form>
      )}
    </article>
  );
}
