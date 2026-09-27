"use client";

import { useEffect, useState } from "react";
import { ArrowSquareOut, CheckCircle, File as FileIcon, Hourglass, ShieldCheck, Warning } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Button, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { formatTimeLeft, revisionsLeft, timeLeft } from "@/lib/creators/review-window";
import {
  approveDelivery,
  deliveryFileUrl,
  openDispute,
  requestRevision,
} from "@/app/(app)/creadores/colaboraciones/actions";
import { ConfirmSheet } from "./confirm-sheet";
import { FLOW_COPY } from "./flow-copy";
import { useContractAction } from "./use-contract-action";

const R = FLOW_COPY.review;

export interface DeliveryView {
  version: number;
  note: string | null;
  createdAtLabel: string;
  files: { path: string; name: string }[];
}

export function DeliveryFiles({ contractId, delivery }: { contractId: string; delivery: DeliveryView }) {
  const { toast } = useToast();
  const [opening, setOpening] = useState<string | null>(null);

  async function view(path: string) {
    setOpening(path);
    // Se abre antes del await para que el navegador no lo trate como popup no
    // pedido; noopener devolvería null, así que se corta el opener a mano.
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    try {
      const result = await deliveryFileUrl(contractId, path);
      if (!result.ok) {
        popup?.close();
        toast({ variant: "danger", title: result.error });
        return;
      }
      if (popup) popup.location.href = result.url;
      else window.location.assign(result.url);
    } catch (error) {
      popup?.close();
      console.error("[entrega] no se pudo abrir el archivo", error);
      toast({ variant: "danger", title: FLOW_COPY.generic });
    } finally {
      setOpening(null);
    }
  }

  return (
    <ul className="flex flex-col gap-2">
      {delivery.files.map((file) => (
        <li key={file.path} className="flex items-center gap-3 rounded-xl bg-surface-subtle px-3 py-2">
          <FileIcon size={18} aria-hidden="true" className="shrink-0 text-foreground-muted" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{file.name}</span>
          <Button variant="outline" size="sm" loading={opening === file.path} onClick={() => view(file.path)}>
            {opening === file.path ? R.opening : R.view}
            <ArrowSquareOut size={14} aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function ReviewPanel({
  contractId,
  role,
  delivery,
  deadlineIso,
  deadlineLabel,
  revisionsIncluded,
  revisionsUsed,
  netAmountLabel,
}: {
  contractId: string;
  role: "client" | "creator";
  delivery: DeliveryView | null;
  deadlineIso: string | null;
  deadlineLabel: string | null;
  revisionsIncluded: number;
  revisionsUsed: number;
  netAmountLabel: string;
}) {
  const now = useNow(30_000);
  const { run, running } = useContractAction();
  const [sheet, setSheet] = useState<"approve" | "revision" | "dispute" | null>(null);
  const left = deadlineIso ? timeLeft(deadlineIso, now) : null;
  const available = revisionsLeft(revisionsIncluded, revisionsUsed);
  const close = () => setSheet(null);

  return (
    <div className="flex flex-col gap-4">
      <BezelCard coreClassName="flex flex-col gap-4 p-5">
        <h2 className="font-display text-lg font-bold text-foreground">{R.title}</h2>
        {delivery && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-foreground">{R.files}</p>
              <DeliveryFiles contractId={contractId} delivery={delivery} />
            </div>
            {delivery.note && (
              <div className="rounded-2xl bg-surface-subtle px-4 py-3">
                <p className="text-xs font-medium text-foreground-muted">{R.messageFrom}</p>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">{delivery.note}</p>
              </div>
            )}
          </>
        )}
        {left && (
          <div
            className={cn(
              "flex items-center gap-3 rounded-2xl px-4 py-3",
              left.expired ? "bg-info-bg" : "bg-warning-bg",
            )}
          >
            <Hourglass size={22} aria-hidden="true" className={left.expired ? "text-info-ink" : "text-warning-ink"} />
            <div className="min-w-0">
              {left.expired ? (
                <p className="text-sm text-foreground">{R.expired}</p>
              ) : (
                <>
                  <p className="text-xs text-foreground-secondary">{R.timeLeft}</p>
                  <p className="numeric font-display text-lg font-bold text-foreground">{formatTimeLeft(left)}</p>
                  <p className="text-xs text-foreground-secondary">{R.timeHint}</p>
                </>
              )}
            </div>
          </div>
        )}
      </BezelCard>

      {role === "client" ? (
        <>
          <Button
            size="lg"
            className="w-full active:scale-[0.98]"
            disabled={running !== null}
            onClick={() => setSheet("approve")}
          >
            <CheckCircle size={18} weight="fill" aria-hidden="true" />
            {R.approve(netAmountLabel)}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={running !== null || available === 0}
              onClick={() => setSheet("revision")}
              className="h-auto min-h-11 flex-col gap-0 py-1.5"
            >
              <span>{R.requestRevision}</span>
              <span className="text-[11px] font-normal text-foreground-muted">
                {available === 0 ? R.noRevisionsLeft : R.revisionsLeft(available, revisionsIncluded)}
              </span>
            </Button>
            <Button variant="ghost" disabled={running !== null} onClick={() => setSheet("dispute")}>
              <Warning size={16} aria-hidden="true" />
              {R.dispute}
            </Button>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-foreground-muted">
            <ShieldCheck size={14} aria-hidden="true" />
            {R.frozen}
          </p>
        </>
      ) : (
        deadlineLabel && (
          <p className="rounded-2xl bg-surface-subtle px-4 py-3 text-sm leading-relaxed text-foreground-secondary">
            {R.creatorWaiting(deadlineLabel)}
          </p>
        )
      )}

      <ConfirmSheet
        open={sheet === "approve"}
        onClose={close}
        title={R.approve(netAmountLabel)}
        body={R.approveConfirm(netAmountLabel)}
        confirmLabel={R.approve(netAmountLabel)}
        loading={running === "approve"}
        onConfirm={() => run("approve", () => approveDelivery(contractId), { success: R.approved, onDone: close })}
      />
      <ConfirmSheet
        open={sheet === "revision"}
        onClose={close}
        title={R.revisionTitle}
        body={R.revisionsLeft(available, revisionsIncluded)}
        confirmLabel={R.requestRevision}
        loading={running === "revision"}
        note={{ label: R.revisionTitle, placeholder: R.revisionPlaceholder }}
        onConfirm={(note) => run("revision", () => requestRevision(contractId, note), { success: R.revisionSent, onDone: close })}
      />
      <ConfirmSheet
        open={sheet === "dispute"}
        onClose={close}
        title={R.disputeTitle}
        body={R.disputeHint}
        confirmLabel={R.dispute}
        tone="danger"
        loading={running === "dispute"}
        note={{ label: R.disputeTitle, placeholder: R.disputePlaceholder }}
        onConfirm={(note) => run("dispute", () => openDispute(contractId, note), { success: R.disputeSent, onDone: close })}
      />
    </div>
  );
}
