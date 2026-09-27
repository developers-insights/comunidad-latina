"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowsClockwise, Check, Plus, UploadSimple, Warning, X } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Button, Input, ProgressBar } from "@/components/ui";
import { cn } from "@/lib/utils";
import { addMilestone, cancelContract, openDispute, setMilestoneDone } from "@/app/(app)/creadores/colaboraciones/actions";
import { ConfirmSheet } from "./confirm-sheet";
import { DeliverySheet } from "./delivery-sheet";
import { FLOW_COPY } from "./flow-copy";
import { useContractAction } from "./use-contract-action";

const W = FLOW_COPY.work;

export interface MilestoneView {
  id: string;
  title: string;
  done: boolean;
}

export function workProgress(milestones: MilestoneView[], delivered: boolean): number {
  const total = milestones.length + 1;
  const done = milestones.filter((m) => m.done).length + (delivered ? 1 : 0);
  return Math.round((done / total) * 100);
}

export function WorkPanel({
  contractId,
  role,
  status,
  milestones,
  workspace,
  revisionNote,
}: {
  contractId: string;
  role: "client" | "creator";
  status: "funded" | "changes_requested";
  milestones: MilestoneView[];
  workspace: ReactNode;
  revisionNote: string | null;
}) {
  const { run, running } = useContractAction();
  const [draft, setDraft] = useState("");
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const view = milestones.map((m) => ({ ...m, done: optimistic[m.id] ?? m.done }));
  const pct = workProgress(view, false);
  const isCreator = role === "creator";

  async function toggle(milestone: MilestoneView) {
    const next = !milestone.done;
    setOptimistic((prev) => ({ ...prev, [milestone.id]: next }));
    const result = await run(`m-${milestone.id}`, () => setMilestoneDone(contractId, milestone.id, next));
    if (!result?.ok) setOptimistic((prev) => ({ ...prev, [milestone.id]: milestone.done }));
  }

  return (
    <div className="flex flex-col gap-4">
      {status === "changes_requested" && revisionNote && (
        <div className="flex items-start gap-2 rounded-2xl bg-warning-bg px-4 py-3 text-sm text-foreground">
          <ArrowsClockwise size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-warning-ink" />
          <div>
            <p className="font-semibold">{W.revisionAsked}</p>
            <p className="mt-0.5 whitespace-pre-line leading-relaxed text-foreground-secondary">{revisionNote}</p>
          </div>
        </div>
      )}

      <BezelCard coreClassName="flex flex-col gap-3 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-foreground">{W.title}</h2>
          <span className="numeric text-sm font-semibold text-foreground-secondary">{W.progress(pct)}</span>
        </div>
        <ProgressBar value={pct} label={W.title} />
      </BezelCard>

      {workspace}

      <BezelCard coreClassName="flex flex-col gap-3 p-5">
        <h3 className="font-display text-base font-bold text-foreground">{W.milestonesTitle}</h3>
        {view.length === 0 && (
          <p className="text-sm leading-relaxed text-foreground-muted">
            {isCreator ? W.milestonesEmptyCreator : W.milestonesEmptyClient}
          </p>
        )}
        <ol className="flex flex-col">
          {view.map((milestone) => (
            <li key={milestone.id} className="flex items-center gap-3 py-2">
              <button
                type="button"
                disabled={!isCreator || running !== null}
                aria-pressed={milestone.done}
                aria-label={W.milestoneToggle(milestone.title, milestone.done)}
                onClick={() => toggle(milestone)}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full ring-1 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-90",
                  milestone.done
                    ? "bg-success-bg text-success-ink ring-transparent"
                    : "bg-surface ring-border",
                  !isCreator && "cursor-default active:scale-100",
                )}
              >
                <Check
                  size={14}
                  weight="bold"
                  aria-hidden="true"
                  className={cn(
                    "transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                    milestone.done ? "scale-100" : "scale-0",
                  )}
                />
              </button>
              <span
                className={cn(
                  "text-sm transition-colors duration-300",
                  milestone.done ? "text-foreground-muted line-through decoration-foreground-muted/50" : "text-foreground",
                )}
              >
                {milestone.title}
              </span>
            </li>
          ))}
          <li className="flex items-center gap-3 py-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-surface">
              <UploadSimple size={13} aria-hidden="true" className="text-foreground-muted" />
            </span>
            <span className="text-sm text-foreground-muted">{W.finalDelivery}</span>
          </li>
        </ol>

        {isCreator && view.length < 10 && (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const title = draft.trim();
              if (title.length < 2) return;
              void run("add", () => addMilestone(contractId, title), { onDone: () => setDraft("") });
            }}
          >
            <Input
              aria-label={W.addMilestone}
              value={draft}
              maxLength={80}
              placeholder={W.milestonePlaceholder}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" variant="secondary" loading={running === "add"} disabled={draft.trim().length < 2}>
              <Plus size={16} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{W.addMilestone}</span>
            </Button>
          </form>
        )}
        <p className="text-xs text-foreground-muted">{W.registered}</p>
      </BezelCard>

      {status === "changes_requested" && (
        <>
          <Button variant="ghost" size="sm" className="self-center" onClick={() => setDisputeOpen(true)}>
            <Warning size={15} aria-hidden="true" />
            {FLOW_COPY.review.dispute}
          </Button>
          <ConfirmSheet
            open={disputeOpen}
            onClose={() => setDisputeOpen(false)}
            title={FLOW_COPY.review.disputeTitle}
            body={FLOW_COPY.review.disputeHint}
            confirmLabel={FLOW_COPY.review.dispute}
            tone="danger"
            loading={running === "dispute"}
            note={{ label: FLOW_COPY.review.disputeTitle, placeholder: FLOW_COPY.review.disputePlaceholder }}
            onConfirm={(note) =>
              run("dispute", () => openDispute(contractId, note), {
                success: FLOW_COPY.review.disputeSent,
                onDone: () => setDisputeOpen(false),
              })
            }
          />
        </>
      )}

      {isCreator ? (
        <>
          <Button size="lg" className="w-full active:scale-[0.98]" onClick={() => setDeliverOpen(true)}>
            <UploadSimple size={18} weight="bold" aria-hidden="true" />
            {W.deliver}
          </Button>
          <DeliverySheet contractId={contractId} open={deliverOpen} onClose={() => setDeliverOpen(false)} />
        </>
      ) : (
        <>
          <p className="rounded-2xl bg-surface-subtle px-4 py-3 text-sm text-foreground-secondary">{W.clientWaiting}</p>
          {status === "funded" && (
            <Button variant="ghost" size="sm" className="self-center" onClick={() => setCancelOpen(true)}>
              <X size={15} aria-hidden="true" />
              {W.cancel}
            </Button>
          )}
          <ConfirmSheet
            open={cancelOpen}
            onClose={() => setCancelOpen(false)}
            title={W.cancel}
            body={W.cancelConfirm}
            confirmLabel={W.cancel}
            tone="danger"
            loading={running === "cancel"}
            onConfirm={() =>
              run("cancel", () => cancelContract(contractId), {
                success: (r) => (r.refundPending ? FLOW_COPY.canceled.refundPending : FLOW_COPY.canceled.refunded),
                onDone: () => setCancelOpen(false),
              })
            }
          />
        </>
      )}
    </div>
  );
}
