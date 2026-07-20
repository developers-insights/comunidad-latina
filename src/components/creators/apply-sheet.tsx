"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button, Field, Input, Textarea } from "@/components/ui";
import { applyToGig } from "@/app/(app)/creadores/actions";
import { COPY } from "./copy";

/**
 * Aplicar a un aviso (bottom-sheet): mensaje + monto propuesto opcional.
 * Optimista en la navegación: al enviar refresca la página para que el estado
 * "ya aplicaste" aparezca sin recargar.
 */
export function ApplySheet({ gigId }: { gigId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (message.trim().length < 20) {
      setError(COPY.apply.errors.messageShort);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await applyToGig({
        gigId,
        message: message.trim(),
        proposedAmount: amount ? Number(amount) : null,
      });
      if (!result.ok) {
        if (result.needsAuth) {
          router.push(`/entrar?next=${encodeURIComponent(`/creadores/${gigId}`)}`);
          return;
        }
        setError(result.error);
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError(COPY.apply.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="primary" size="lg" className="w-full" onClick={() => setOpen(true)}>
        <PaperPlaneTilt size={20} weight="fill" aria-hidden="true" />
        {COPY.apply.title}
      </Button>

      <BottomSheet
        open={open}
        onClose={() => {
          if (!submitting) setOpen(false);
        }}
        title={done ? undefined : COPY.apply.title}
        ariaLabel={COPY.apply.title}
      >
        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle size={52} weight="fill" aria-hidden="true" className="text-success" />
            <h3 className="font-display text-lg font-bold text-foreground">
              {COPY.apply.successTitle}
            </h3>
            <p className="max-w-[40ch] text-sm text-foreground-secondary">
              {COPY.apply.successBody}
            </p>
            <Button variant="primary" className="mt-2 w-full" onClick={() => setOpen(false)}>
              Listo
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-2">
            <p className="text-sm text-foreground-secondary">{COPY.apply.intro}</p>

            <Field htmlFor="apply-message" label={COPY.apply.messageLabel} help={COPY.apply.messageHelp}>
              <Textarea
                id="apply-message"
                rows={5}
                value={message}
                maxLength={1000}
                placeholder={COPY.apply.messagePlaceholder}
                onChange={(event) => setMessage(event.target.value)}
              />
            </Field>

            <Field htmlFor="apply-amount" label={COPY.apply.amountLabel} help={COPY.apply.amountHelp} optional>
              <Input
                id="apply-amount"
                type="number"
                inputMode="decimal"
                min={0}
                value={amount}
                placeholder={COPY.apply.amountPlaceholder}
                onChange={(event) => setAmount(event.target.value)}
                className="numeric"
              />
            </Field>

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
              {submitting ? COPY.apply.submitting : COPY.apply.submit}
            </Button>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
