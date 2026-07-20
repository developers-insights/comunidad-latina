"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button, Field, Input, Textarea, type ButtonProps } from "@/components/ui";
import { cn } from "@/lib/utils";
import { proposeContract } from "@/app/(app)/creadores/actions";
import { dollarsToCents } from "./money";
import { DemoSeal } from "./demo-seal";
import { COPY } from "./copy";

export interface ContractFormProps {
  creatorId: string;
  creatorName: string;
  /** Presente si el contrato nace de una aplicación aceptada. */
  applicationId?: string | null;
  defaultTitle?: string;
  defaultScope?: string;
  /** Monto a prellenar (propuesto por el creador o presupuesto del aviso). */
  defaultAmountCents?: number | null;
  triggerLabel: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  triggerClassName?: string;
}

/**
 * Propuesta de contrato (bottom-sheet). La abre el CLIENTE: define qué se
 * entrega, en cuánto tiempo y por cuánto. Al crear, navega al detalle del
 * contrato donde deposita el pago en garantía (modo demostración).
 */
export function ContractForm({
  creatorId,
  creatorName,
  applicationId = null,
  defaultTitle = "",
  defaultScope = "",
  defaultAmountCents = null,
  triggerLabel,
  triggerVariant = "primary",
  triggerSize = "md",
  triggerClassName,
}: ContractFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [scope, setScope] = useState(defaultScope);
  const [deliveryDays, setDeliveryDays] = useState("7");
  const [amount, setAmount] = useState(
    defaultAmountCents ? String(Math.round(defaultAmountCents / 100)) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const amountValue = Number(amount);
    if (title.trim().length < 6) return setError(COPY.contract.errors.titleShort);
    if (scope.trim().length < 10) return setError(COPY.contract.errors.scopeShort);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      return setError(COPY.contract.errors.amountRequired);
    }
    const days = Number(deliveryDays);
    if (!Number.isInteger(days) || days < 1) {
      return setError(COPY.contract.errors.generic);
    }

    setError(null);
    setSubmitting(true);
    try {
      const result = await proposeContract({
        creatorId,
        applicationId,
        title: title.trim(),
        scope: scope.trim(),
        deliveryDays: days,
        amountCents: dollarsToCents(amountValue),
      });
      if (!result.ok) {
        if (result.needsAuth) {
          router.push("/entrar");
          return;
        }
        setError(result.error);
        return;
      }
      router.push(`/creadores/contratos/${result.contractId}`);
    } catch {
      setError(COPY.contract.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant={triggerVariant}
        size={triggerSize}
        className={cn(triggerClassName)}
        onClick={() => setOpen(true)}
      >
        <FileText size={triggerSize === "sm" ? 15 : 18} weight="fill" aria-hidden="true" />
        {triggerLabel}
      </Button>

      <BottomSheet
        open={open}
        onClose={() => {
          if (!submitting) setOpen(false);
        }}
        title={COPY.contract.proposeTitle}
      >
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-foreground-secondary">
              {COPY.contract.withCreator} <span className="font-semibold text-foreground">{creatorName}</span>
            </p>
            <DemoSeal />
          </div>
          <p className="-mt-1 text-sm text-foreground-secondary">{COPY.contract.proposeIntro}</p>

          <Field htmlFor="contract-title" label={COPY.contract.titleLabel}>
            <Input
              id="contract-title"
              value={title}
              maxLength={120}
              placeholder={COPY.contract.titlePlaceholder}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>

          <Field htmlFor="contract-scope" label={COPY.contract.scopeLabel}>
            <Textarea
              id="contract-scope"
              rows={4}
              value={scope}
              maxLength={2000}
              placeholder={COPY.contract.scopePlaceholder}
              onChange={(event) => setScope(event.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field htmlFor="contract-amount" label={COPY.contract.amountLabel} help={COPY.contract.amountHelp}>
              <Input
                id="contract-amount"
                type="number"
                inputMode="decimal"
                min={1}
                value={amount}
                placeholder="800"
                onChange={(event) => setAmount(event.target.value)}
                className="numeric"
              />
            </Field>
            <Field htmlFor="contract-days" label={COPY.contract.deliveryLabel}>
              <Input
                id="contract-days"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={deliveryDays}
                onChange={(event) => setDeliveryDays(event.target.value)}
                className="numeric"
              />
            </Field>
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            loading={submitting}
            onClick={handleSubmit}
          >
            {submitting ? COPY.contract.creating : COPY.contract.create}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
