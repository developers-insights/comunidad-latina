"use client";

import { useId, useState } from "react";
import { CaretDown, CheckCircle, Clock, PenNib, X } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Button, Field, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { cancelContract, requestTermsChanges, signContract } from "@/app/(app)/creadores/colaboraciones/actions";
import { ConfirmSheet } from "./confirm-sheet";
import { ContractDocumentSheet, type SignatureView } from "./contract-document-sheet";
import { FLOW_COPY } from "./flow-copy";
import { SignaturePad } from "./signature-pad";
import { useContractAction } from "./use-contract-action";

const S = FLOW_COPY.signing;

export interface SigningParty {
  role: "client" | "creator";
  name: string;
  signed: boolean;
  isYou: boolean;
}

export function SigningPanel({
  contractId,
  termsHash,
  contractText,
  versionLabel,
  parties,
  summary,
  cancellation,
  signatures,
  youSigned,
}: {
  contractId: string;
  termsHash: string;
  contractText: string;
  versionLabel: string;
  parties: SigningParty[];
  summary: { label: string; value: string }[];
  cancellation: string[];
  signatures: SignatureView[];
  youSigned: boolean;
}) {
  const nameId = useId();
  const padId = useId();
  const consentId = useId();
  const { run, running } = useContractAction();
  const [legalName, setLegalName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [showConditions, setShowConditions] = useState(false);
  const [sheet, setSheet] = useState<"changes" | "cancel" | null>(null);

  const ready = legalName.trim().split(/\s+/).length >= 2 && signature !== null && accepted;

  return (
    <div className="flex flex-col gap-4">
      <BezelCard coreClassName="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">{S.title}</h2>
            <p className="mt-0.5 text-xs text-foreground-muted">{versionLabel}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-bg px-2.5 py-1 text-[11px] font-semibold text-warning-ink">
            <Clock size={12} weight="bold" aria-hidden="true" />
            {S.pending}
          </span>
        </div>

        <ul className="grid grid-cols-2 gap-2">
          {parties.map((party) => (
            <li
              key={party.role}
              className={cn(
                "flex flex-col gap-1 rounded-2xl px-3 py-2.5 transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                party.signed ? "bg-success-bg" : "bg-surface-subtle",
              )}
            >
              <span className="text-[11px] font-medium text-foreground-muted">
                {party.role === "client" ? S.client : S.creator}
                {party.isYou && ` · ${S.you}`}
              </span>
              <span className="truncate text-sm font-semibold text-foreground">{party.name}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-semibold",
                  party.signed ? "text-success-ink" : "text-foreground-muted",
                )}
              >
                {party.signed ? (
                  <CheckCircle size={14} weight="fill" aria-hidden="true" />
                ) : (
                  <Clock size={14} aria-hidden="true" />
                )}
                {party.signed ? S.signed : S.waiting}
              </span>
            </li>
          ))}
        </ul>

        <dl className="flex flex-col divide-y divide-border-subtle rounded-2xl bg-surface-subtle px-4">
          {summary.map((item) => (
            <div key={item.label} className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-sm text-foreground-secondary">{item.label}</dt>
              <dd className="text-right text-sm font-semibold text-foreground">{item.value}</dd>
            </div>
          ))}
          <div className="py-2.5">
            <button
              type="button"
              aria-expanded={showConditions}
              onClick={() => setShowConditions((v) => !v)}
              className="flex w-full items-center justify-between gap-4 text-left"
            >
              <span className="text-sm text-foreground-secondary">{S.cancellation}</span>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-ink">
                {S.seeConditions}
                <CaretDown
                  size={14}
                  aria-hidden="true"
                  className={cn(
                    "transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    showConditions && "rotate-180",
                  )}
                />
              </span>
            </button>
            <div
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                showConditions ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <ul className="overflow-hidden text-sm leading-relaxed text-foreground-secondary">
                {cancellation.map((clause) => (
                  <li key={clause} className="mt-2 flex gap-2">
                    <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-foreground-muted" />
                    {clause}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </dl>

        <ContractDocumentSheet text={contractText} signatures={signatures} version={versionLabel} triggerClassName="self-start" />
      </BezelCard>

      {youSigned ? (
        <p className="flex items-start gap-2 rounded-2xl bg-success-bg px-4 py-3 text-sm leading-relaxed text-success-ink">
          <CheckCircle size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          {S.youSigned}
        </p>
      ) : (
        <BezelCard coreClassName="flex flex-col gap-4 p-5">
          <Field htmlFor={nameId} label={S.legalName} help={S.legalNameHelp}>
            <Input
              id={nameId}
              autoComplete="name"
              value={legalName}
              maxLength={120}
              onChange={(event) => setLegalName(event.target.value)}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={padId} className="text-sm font-medium text-foreground">
              {S.signatureLabel}
            </label>
            <SignaturePad id={padId} onChange={setSignature} disabled={running !== null} />
          </div>
          <label htmlFor={consentId} className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
            <input
              id={consentId}
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[var(--color-brand)]"
            />
            <span className="leading-snug">{S.consent}</span>
          </label>
          <Button
            size="lg"
            className="w-full active:scale-[0.98]"
            disabled={!ready || running !== null}
            loading={running === "sign"}
            onClick={() =>
              signature &&
              run(
                "sign",
                () => signContract(contractId, { legalName, signaturePng: signature, accepted, termsHash }),
                { success: (r) => (r.bothSigned ? S.doneBoth : S.done) },
              )
            }
          >
            <PenNib size={18} weight="fill" aria-hidden="true" />
            {S.submit}
          </Button>
        </BezelCard>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={running !== null} onClick={() => setSheet("changes")}>
          {S.requestChanges}
        </Button>
        <Button variant="ghost" disabled={running !== null} onClick={() => setSheet("cancel")}>
          <X size={16} aria-hidden="true" />
          {S.cancel}
        </Button>
      </div>
      <p className="text-center text-xs text-foreground-muted">{S.paymentGate}</p>

      <ConfirmSheet
        open={sheet === "changes"}
        onClose={() => setSheet(null)}
        title={S.requestChanges}
        body={S.requestChangesHint}
        confirmLabel={FLOW_COPY.proposal.send}
        loading={running === "changes"}
        note={{ label: S.requestChanges, placeholder: FLOW_COPY.proposal.negotiatePlaceholder }}
        onConfirm={(note) =>
          run("changes", () => requestTermsChanges(contractId, note), {
            success: FLOW_COPY.proposal.sent,
            onDone: () => setSheet(null),
          })
        }
      />
      <ConfirmSheet
        open={sheet === "cancel"}
        onClose={() => setSheet(null)}
        title={S.cancel}
        body={S.cancelConfirm}
        confirmLabel={S.cancel}
        tone="danger"
        loading={running === "cancel"}
        onConfirm={() => run("cancel", () => cancelContract(contractId), { onDone: () => setSheet(null) })}
      />
    </div>
  );
}
