"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowUpRight, Clock, CreditCard, LockKey, X } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { cancelContract, startPayment } from "@/app/(app)/creadores/colaboraciones/actions";
import { ConfirmSheet } from "./confirm-sheet";
import { FLOW_COPY } from "./flow-copy";
import { useContractAction } from "./use-contract-action";

const P = FLOW_COPY.payment;

export function PaymentPanel({
  contractId,
  role,
  amountLabel,
  breakdown,
  checkoutOpen,
  returnState,
}: {
  contractId: string;
  role: "client" | "creator";
  amountLabel: string;
  breakdown: ReactNode;
  checkoutOpen: boolean;
  returnState: "exito" | "cancelado" | null;
}) {
  const { run, running } = useContractAction();
  const [redirecting, setRedirecting] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (role === "creator") {
    return (
      <div className="flex flex-col gap-4">
        {breakdown}
        <p className="flex items-start gap-2 rounded-2xl bg-surface-subtle px-4 py-3 text-sm leading-relaxed text-foreground-secondary">
          <Clock size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          {P.creatorWaiting}
        </p>
      </div>
    );
  }

  const processing = returnState === "exito";

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-bold text-foreground">{P.title}</h2>
      {breakdown}

      {processing ? (
        <p role="status" className="flex items-start gap-2 rounded-2xl bg-info-bg px-4 py-3 text-sm leading-relaxed text-info-ink">
          <LockKey size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          {P.processing}
        </p>
      ) : (
        <>
          {returnState === "cancelado" && (
            <p className="rounded-2xl bg-surface-subtle px-4 py-3 text-sm text-foreground-secondary">{P.canceled}</p>
          )}
          {checkoutOpen && returnState !== "cancelado" && (
            <div className="flex items-start gap-2 rounded-2xl bg-warning-bg px-4 py-3 text-sm text-foreground">
              <Clock size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-warning-ink" />
              <p>
                <span className="font-semibold">{P.pendingTitle}: </span>
                {P.pending}
              </p>
            </div>
          )}
          <Button
            size="lg"
            className="group w-full active:scale-[0.98]"
            loading={running === "pay" || redirecting}
            disabled={running !== null || redirecting}
            onClick={() =>
              run("pay", () => startPayment(contractId), {
                success: (r) => (r.demo ? P.demoDone : null),
                onDone: (r) => {
                  if (r.url) {
                    setRedirecting(true);
                    window.location.assign(r.url);
                  }
                },
              })
            }
          >
            <CreditCard size={18} weight="fill" aria-hidden="true" />
            {P.pay(amountLabel)}
            <span className="ml-1 inline-flex size-7 items-center justify-center rounded-full bg-brand-foreground/15 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-px group-hover:translate-x-0.5">
              <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
            </span>
          </Button>
          <p className="text-center text-xs text-foreground-muted">{P.cardOnly}</p>
          <Button variant="ghost" size="sm" className="self-center" disabled={running !== null} onClick={() => setCancelOpen(true)}>
            <X size={15} aria-hidden="true" />
            {FLOW_COPY.signing.cancel}
          </Button>
        </>
      )}

      <ConfirmSheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={FLOW_COPY.signing.cancel}
        body={FLOW_COPY.signing.cancelConfirm}
        confirmLabel={FLOW_COPY.signing.cancel}
        tone="danger"
        loading={running === "cancel"}
        onConfirm={() => run("cancel", () => cancelContract(contractId), { onDone: () => setCancelOpen(false) })}
      />
    </div>
  );
}
