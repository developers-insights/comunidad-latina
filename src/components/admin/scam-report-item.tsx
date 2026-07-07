"use client";

import { useActionState } from "react";
import { Flag, HandPalm } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui";
import {
  resolveScamReport,
  type DomainActionState,
} from "@/app/admin/dominio/actions";
import { PendingButton } from "./pending-button";

/**
 * Reporte de estafa abierto (panel Dominio): detalle + resolver.
 * "Confirmar" (upheld) baja el aviso reportado; "Descartar" (dismissed) lo
 * cierra sin efecto. El peso ya viene ponderado por Trust Score desde la DB.
 */

export interface ScamReportData {
  id: string;
  targetKind: string;
  targetLabel: string;
  reason: string;
  details: string | null;
  weight: number;
  createdAt: string;
}

const COPY = {
  uphold: "Confirmar estafa",
  dismiss: "Descartar",
  upholdHint: "Confirmar baja el contenido reportado y alimenta el Escudo.",
  weight: (w: number) => `Peso ${w}`,
  targetLabel: {
    listing: "Aviso",
    profile: "Perfil",
    message: "Mensaje",
  } as Record<string, string>,
} as const;

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

const initialState: DomainActionState = { status: "idle" };

export function ScamReportItem({ report }: { report: ScamReportData }) {
  const [state, formAction] = useActionState(resolveScamReport, initialState);

  return (
    <article className="rounded-lg border border-danger/25 bg-surface p-4 shadow-xs">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant="danger">
          <Flag size={12} weight="fill" aria-hidden="true" />
          {COPY.targetLabel[report.targetKind] ?? report.targetKind}
        </Badge>
        <Badge variant="warning">{COPY.weight(report.weight)}</Badge>
        <span className="ml-auto text-xs tabular-nums text-foreground-muted">
          {formatWhen(report.createdAt)}
        </span>
      </header>

      <h3 className="mt-2 text-sm font-semibold text-foreground">{report.reason}</h3>
      <p className="text-xs text-foreground-muted">{report.targetLabel}</p>
      {report.details && (
        <p className="mt-1.5 line-clamp-4 break-words rounded-md bg-surface-subtle px-3 py-2 text-sm text-foreground-secondary">
          {report.details}
        </p>
      )}

      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.message}
        </p>
      )}

      <form action={formAction} className="mt-4">
        <input type="hidden" name="reportId" value={report.id} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PendingButton variant="ghost" size="sm" name="decision" value="dismissed" type="submit">
            <HandPalm size={16} aria-hidden="true" />
            {COPY.dismiss}
          </PendingButton>
          <PendingButton variant="danger" size="sm" name="decision" value="upheld" type="submit">
            <Flag size={16} aria-hidden="true" />
            {COPY.uphold}
          </PendingButton>
        </div>
        <p className="mt-2 text-right text-xs text-foreground-muted">{COPY.upholdHint}</p>
      </form>
    </article>
  );
}
