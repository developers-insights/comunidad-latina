"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "@phosphor-icons/react/dist/ssr";
import { AUTH_REASON, useRequireAuth } from "@/components/auth/auth-sheet";
import { BottomSheet, Button, Field, Input, Textarea, type ButtonProps } from "@/components/ui";
import { cn } from "@/lib/utils";
import { proposeContract } from "@/app/(app)/creadores/actions";
import { centsToInput } from "@/lib/pricing/money";
import { dollarsToCents } from "./money";
import { ContactBlockNotice, hasContactInfo } from "./contact-block-notice";
import { DemoSeal } from "./demo-seal";
import { COPY } from "./copy";

/**
 * Centavos → el texto del input de monto, SIN perder los centavos.
 *
 * Antes esto era `String(Math.round(cents / 100))` inline, que sobre un paquete
 * de USD 150,50 escribía "151": el contrato nacía con medio dólar de más que el
 * precio publicado, y eso no se descubre hasta el reclamo. Los montos redondos
 * se siguen escribiendo sin decimales ("800", no "800.00") porque es lo que ya
 * veían quienes prellenan desde un presupuesto de aviso.
 */
function prefillAmount(cents: number): string {
  return cents % 100 === 0 ? String(Math.trunc(cents / 100)) : centsToInput(cents);
}

export interface ContractFormProps {
  creatorId: string;
  creatorName: string;
  /** Presente si el contrato nace de una aplicación aceptada. */
  applicationId?: string | null;
  defaultTitle?: string;
  defaultScope?: string;
  /** Monto a prellenar (propuesto por el creador o presupuesto del aviso). */
  defaultAmountCents?: number | null;
  /** Días de entrega a prellenar (los del paquete de servicio, si viene de uno). */
  defaultDeliveryDays?: number | null;
  triggerLabel: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  triggerClassName?: string;
  /**
   * ¿Había sesión cuando el servidor pintó esta pantalla?
   *
   * Ausente = `true`, que es lo que valía hasta hoy: los dos llamadores viejos
   * (el CTA del perfil y el de una aplicación aceptada) sólo se renderizan con
   * sesión, así que para ellos nada cambia.
   *
   * En `false` la puerta se pide ANTES de abrir el formulario, no al enviarlo.
   * Es a propósito y va contra el patrón del resto de la app: acá hay cuatro
   * campos, y los caminos de entrada que se van del navegador (Google, enlace
   * mágico) vuelven en otra carga, sin árbol de React — o sea, sin lo que la
   * persona había escrito. Pedir primero cuesta un toque; pedir al final puede
   * costar el contrato entero escrito de nuevo.
   */
  isAuthenticated?: boolean;
}

/**
 * Propuesta de contrato (bottom-sheet). La abre el CLIENTE: define qué se
 * entrega, en cuánto tiempo y por cuánto. Al crear, navega al detalle de la
 * colaboración donde deposita el pago en garantía (modo demostración).
 *
 * Bloqueo de datos de contacto (§6): corre sobre título y alcance, los dos
 * campos de texto libre que lee la otra parte. La regla es simétrica con la
 * del creador — si sólo se controlara del otro lado, el "coordinamos por
 * WhatsApp" entraría por acá. El servidor vuelve a chequearlo antes de
 * escribir; esto es para no hacer escribir de más.
 */
export function ContractForm({
  creatorId,
  creatorName,
  applicationId = null,
  defaultTitle = "",
  defaultScope = "",
  defaultAmountCents = null,
  defaultDeliveryDays = null,
  triggerLabel,
  triggerVariant = "primary",
  triggerSize = "md",
  triggerClassName,
  isAuthenticated = true,
}: ContractFormProps) {
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [scope, setScope] = useState(defaultScope);
  const [deliveryDays, setDeliveryDays] = useState(
    defaultDeliveryDays ? String(defaultDeliveryDays) : "7",
  );
  const [amount, setAmount] = useState(
    defaultAmountCents ? prefillAmount(defaultAmountCents) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contactBlocked = hasContactInfo(title, scope);

  /**
   * Abrir la propuesta. Sin sesión pide entrar acá mismo y la abre recién
   * después: ver `isAuthenticated`. El `setOpen(true)` va DENTRO de
   * `onAuthenticated` —nunca antes— para que cerrar la hoja sin entrar no deje
   * un formulario que se abre solo en la próxima entrada.
   */
  function openProposal() {
    if (!isAuthenticated) {
      requireAuth({
        reason: AUTH_REASON.contract,
        onAuthenticated: () => setOpen(true),
      });
      return;
    }
    setOpen(true);
  }

  async function handleSubmit() {
    if (contactBlocked) return;
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
          /**
           * Red de seguridad para la sesión que se venció con el formulario ya
           * escrito (el caso de arriba, `isAuthenticated`, la evita antes de
           * empezar). La hoja de entrada se apila SOBRE esta propuesta, que
           * sigue montada con todo lo escrito, y al entrar se reintenta el
           * mismo envío. Antes esto era un `router.push` a /entrar: el contrato
           * a medio escribir se perdía entero.
           */
          requireAuth({
            reason: AUTH_REASON.contract,
            onAuthenticated: () => void handleSubmit(),
          });
          return;
        }
        setError(result.error);
        return;
      }
      router.push(`/creadores/colaboraciones/${result.contractId}`);
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
        onClick={openProposal}
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

          <ContactBlockNotice text={[title, scope].join("\n")} />

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
            disabled={contactBlocked}
            onClick={handleSubmit}
          >
            {submitting ? COPY.contract.creating : COPY.contract.create}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
