"use client";

import { useState } from "react";
import { ChatsCircle, Handshake, PencilSimple, X } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button, Field, Input, Select, Textarea } from "@/components/ui";
import {
  acceptProposal,
  cancelContract,
  editProposal,
  rejectProposal,
  requestTermsChanges,
} from "@/app/(app)/creadores/colaboraciones/actions";
import { centsToInput } from "@/lib/pricing/money";
import { REVISIONS_MAX, REVISIONS_MIN } from "@/lib/creators/contract-terms";
import { ConfirmSheet } from "./confirm-sheet";
import { FLOW_COPY } from "./flow-copy";
import { COPY } from "./copy";
import { dollarsToCents } from "./money";
import { useContractAction } from "./use-contract-action";

const P = FLOW_COPY.proposal;

export interface ProposalTerms {
  title: string;
  scope: string;
  deliveryDays: number;
  amountCents: number;
  revisionsIncluded: number;
  usageRights: string;
  proposalMessage: string | null;
}

export function ProposalActions({
  contractId,
  role,
  terms,
}: {
  contractId: string;
  role: "client" | "creator";
  terms: ProposalTerms;
}) {
  const { run, running } = useContractAction();
  const [sheet, setSheet] = useState<"negotiate" | "reject" | "withdraw" | "edit" | null>(null);
  const close = () => setSheet(null);

  if (role === "creator") {
    return (
      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          className="w-full active:scale-[0.98]"
          loading={running === "accept"}
          disabled={running !== null}
          onClick={() => run("accept", () => acceptProposal(contractId), { success: P.accepted })}
        >
          <Handshake size={18} weight="fill" aria-hidden="true" />
          {P.accept}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={running !== null} onClick={() => setSheet("negotiate")}>
            <ChatsCircle size={17} aria-hidden="true" />
            {P.negotiate}
          </Button>
          <Button variant="ghost" disabled={running !== null} onClick={() => setSheet("reject")}>
            <X size={17} aria-hidden="true" />
            {P.reject}
          </Button>
        </div>
        <p className="text-center text-xs text-foreground-muted">{P.acceptHint}</p>

        <ConfirmSheet
          open={sheet === "negotiate"}
          onClose={close}
          title={P.negotiateTitle}
          body={P.negotiateHint}
          confirmLabel={P.send}
          loading={running === "negotiate"}
          note={{ label: P.negotiate, placeholder: P.negotiatePlaceholder }}
          onConfirm={(note) =>
            run("negotiate", () => requestTermsChanges(contractId, note), { success: P.sent, onDone: close })
          }
        />
        <ConfirmSheet
          open={sheet === "reject"}
          onClose={close}
          title={P.reject}
          body={P.rejectConfirm}
          confirmLabel={P.reject}
          tone="danger"
          loading={running === "reject"}
          onConfirm={() => run("reject", () => rejectProposal(contractId), { success: P.rejected, onDone: close })}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="rounded-2xl bg-surface-subtle px-4 py-3 text-sm leading-relaxed text-foreground-secondary">
        {P.waitingCreator}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={running !== null} onClick={() => setSheet("edit")}>
          <PencilSimple size={17} aria-hidden="true" />
          {P.edit}
        </Button>
        <Button variant="ghost" disabled={running !== null} onClick={() => setSheet("withdraw")}>
          <X size={17} aria-hidden="true" />
          {P.withdraw}
        </Button>
      </div>

      <EditProposalSheet
        open={sheet === "edit"}
        onClose={close}
        terms={terms}
        loading={running === "edit"}
        onSave={(input) => run("edit", () => editProposal(contractId, input), { success: P.saved, onDone: close })}
      />
      <ConfirmSheet
        open={sheet === "withdraw"}
        onClose={close}
        title={P.withdraw}
        body={P.withdrawConfirm}
        confirmLabel={P.withdraw}
        tone="danger"
        loading={running === "withdraw"}
        onConfirm={() => run("withdraw", () => cancelContract(contractId), { success: P.withdrawn, onDone: close })}
      />
    </div>
  );
}

function amountInput(cents: number): string {
  return cents % 100 === 0 ? String(Math.trunc(cents / 100)) : centsToInput(cents);
}

function EditProposalSheet({
  open,
  onClose,
  terms,
  loading,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  terms: ProposalTerms;
  loading: boolean;
  onSave: (input: Parameters<typeof editProposal>[1]) => void;
}) {
  const [title, setTitle] = useState(terms.title);
  const [scope, setScope] = useState(terms.scope);
  const [days, setDays] = useState(String(terms.deliveryDays));
  const [amount, setAmount] = useState(amountInput(terms.amountCents));
  const [revisions, setRevisions] = useState(String(terms.revisionsIncluded));
  const [usage, setUsage] = useState(terms.usageRights);
  const [message, setMessage] = useState(terms.proposalMessage ?? "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    const amountValue = Number(amount);
    const daysValue = Number(days);
    if (title.trim().length < 6) return setError(COPY.contract.errors.titleShort);
    if (scope.trim().length < 10) return setError(COPY.contract.errors.scopeShort);
    if (!Number.isFinite(amountValue) || amountValue <= 0) return setError(COPY.contract.errors.amountRequired);
    if (!Number.isInteger(daysValue) || daysValue < 1) return setError(COPY.contract.errors.generic);
    setError(null);
    onSave({
      title: title.trim(),
      scope: scope.trim(),
      deliveryDays: daysValue,
      amountCents: dollarsToCents(amountValue),
      revisionsIncluded: Number(revisions),
      usageRights: usage,
      proposalMessage: message.trim() || null,
    });
  }

  return (
    <BottomSheet open={open} onClose={() => !loading && onClose()} title={P.editTitle} size="tall" keyboardAware>
      <div className="flex flex-col gap-4 pb-2">
        <Field htmlFor="edit-title" label={COPY.contract.titleLabel}>
          <Input id="edit-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field htmlFor="edit-scope" label={COPY.contract.scopeLabel}>
          <Textarea id="edit-scope" rows={4} value={scope} maxLength={2000} onChange={(e) => setScope(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field htmlFor="edit-amount" label={COPY.contract.amountLabel}>
            <Input
              id="edit-amount"
              type="number"
              inputMode="decimal"
              min={1}
              value={amount}
              className="numeric"
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field htmlFor="edit-days" label={COPY.contract.deliveryLabel}>
            <Input
              id="edit-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={days}
              className="numeric"
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
          <Field htmlFor="edit-revisions" label={COPY.contract.revisionsLabel}>
            <Select id="edit-revisions" value={revisions} onChange={(e) => setRevisions(e.target.value)}>
              {Array.from({ length: REVISIONS_MAX - REVISIONS_MIN + 1 }, (_, i) => REVISIONS_MIN + i).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="edit-usage" label={COPY.contract.usageRightsLabel}>
            <Input id="edit-usage" value={usage} maxLength={120} onChange={(e) => setUsage(e.target.value)} />
          </Field>
        </div>
        <Field htmlFor="edit-message" label={COPY.contract.messageLabel} optional>
          <Textarea id="edit-message" rows={2} value={message} maxLength={600} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <Button size="lg" className="w-full active:scale-[0.98]" loading={loading} onClick={save}>
          {P.save}
        </Button>
      </div>
    </BottomSheet>
  );
}
