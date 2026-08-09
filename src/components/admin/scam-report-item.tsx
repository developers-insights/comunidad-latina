"use client";

import { useActionState } from "react";
import { Flag, HandPalm } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui";
import {
  resolveScamReport,
  type DomainActionState,
} from "@/app/admin/dominio/actions";
import { formatAdminDateTime } from "./format";
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
  readOnly: "Se resuelve desde la propia comunidad.",
} as const;

const initialState: DomainActionState = { status: "idle" };

export function ScamReportItem({
  report,
  readOnly = false,
}: {
  report: ScamReportData;
  /**
   * Oculta Confirmar/Descartar. Igual que en el listado de avisos: la policy
   * `scam_reports_update` (0005) exige el tenant del JWT y no tiene rama de
   * global_admin, así que un súper admin mirando otra comunidad puede leer el
   * reporte pero no resolverlo. Lo decide la base; acá sólo no se ofrece.
   */
  readOnly?: boolean;
}) {
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
          {formatAdminDateTime(report.createdAt)}
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

      {readOnly ? (
        <p className="mt-4 text-right text-xs text-foreground-muted">{COPY.readOnly}</p>
      ) : (
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
      )}
    </article>
  );
}
