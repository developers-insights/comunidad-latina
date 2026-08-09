"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle, DeviceMobile, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import {
  removePhoneAction,
  sendPhoneCodeAction,
  verifyPhoneCodeAction,
} from "./actions";
import { FormError } from "@/components/auth/form-error";
import { BezelCard, Button, Field, Input, useToast } from "@/components/ui";

/**
 * Verificar el teléfono con un código por SMS.
 *
 * ── DOS PASOS, UNA PANTALLA ──────────────────────────────────────────────────
 * Número → código. No hay navegación entre medio: cambiar de pantalla mientras
 * llega un SMS es la forma más rápida de perder a alguien que salió a mirar la
 * bandeja de mensajes y volvió a otra cosa. El paso 1 se queda visible, en
 * modo lectura, con un "cambiar" al lado — errarle al número es el error más
 * común y tiene que costar un toque.
 *
 * ── EL CÓDIGO SE PEGA, NO SE TIPEA ───────────────────────────────────────────
 * `autoComplete="one-time-code"` + `inputMode="numeric"`: iOS y Android ofrecen
 * el código del SMS arriba del teclado y se completa con un toque. Es la única
 * razón por la que este campo NO es de seis casillas separadas — se ven lindas
 * y rompen justamente el autocompletado.
 */

const COPY = {
  stepPhoneTitle: "Verificá tu teléfono",
  stepPhoneBody:
    "Te mandamos un código por mensaje de texto. Tu número no se muestra en tu perfil ni se comparte con nadie.",
  phoneLabel: "Tu número de teléfono",
  phonePlaceholder: "(917) 555-0142",
  phoneHelp: "Si es de Estados Unidos, con los 10 dígitos alcanza.",
  sendCta: "Mandame el código",
  resendCta: "Mandar otro código",
  resendWait: (seconds: number) => `Podés pedir otro en ${seconds} s`,

  stepCodeTitle: "Escribí el código",
  stepCodeBody: (masked: string, minutes: number) =>
    `Te lo mandamos al ${masked}. Vence en ${minutes} minutos.`,
  codeLabel: "Código de 6 números",
  verifyCta: "Verificar",
  changePhone: "Usar otro número",

  verifiedTitle: "Tu teléfono está verificado",
  verifiedBody: (masked: string) =>
    `Verificamos ${masked}. Sirve para recuperar tu cuenta y suma a tu Trust Score.`,
  remove: "Quitar mi teléfono",
  removed: "Listo, borramos tu número.",
  verified: "Listo, tu teléfono quedó verificado.",
} as const;

/** Espera entre reenvíos. El límite REAL es del servidor (3/hora, 10/día). */
const RESEND_SECONDS = 60;

export interface PhoneVerificationProps {
  /** Número enmascarado ya verificado, o null. */
  verifiedPhone: string | null;
  /**
   * Minutos que dura el código. Baja como prop desde el server porque el valor
   * es de `lib/phone/verification`, que es `server-only` — y tiene que ser el
   * mismo que el DEFAULT de `phone_verification_codes.expires_at`, no un 10
   * escrito a mano acá que se olvide de cambiar.
   */
  ttlMinutes: number;
}

export function PhoneVerification({ verifiedPhone, ttlMinutes }: PhoneVerificationProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);

  const [verified, setVerified] = useState(verifiedPhone);
  const [phone, setPhone] = useState("");
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function send() {
    setFormError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await sendPhoneCodeAction({ phone });
      if (result.ok) {
        setMaskedPhone(result.maskedPhone);
        setCooldown(RESEND_SECONDS);
        // El foco va al campo del código: es el único lugar donde hay algo que
        // hacer, y sin esto queda en el botón que ya se usó.
        window.setTimeout(() => codeRef.current?.focus(), 50);
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? null);
    });
  }

  function verify() {
    setFormError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await verifyPhoneCodeAction({ phone, code });
      if (result.ok) {
        setVerified(maskedPhone);
        setCode("");
        toast({ title: COPY.verified, variant: "success" });
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? null);
      codeRef.current?.focus();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removePhoneAction();
      if (result.ok) {
        setVerified(null);
        setMaskedPhone(null);
        setPhone("");
        toast({ title: COPY.removed, variant: "success" });
        return;
      }
      setFormError(result.formError ?? null);
    });
  }

  /* ── Ya verificado ───────────────────────────────────────────────────── */
  if (verified) {
    return (
      <BezelCard coreClassName="flex flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-bg text-success"
          >
            <CheckCircle size={22} weight="fill" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-foreground">
              {COPY.verifiedTitle}
            </h2>
            <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
              {COPY.verifiedBody(verified)}
            </p>
          </div>
        </div>
        <FormError>{formError}</FormError>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={pending}
          className="self-start"
          onClick={remove}
        >
          {COPY.remove}
        </Button>
      </BezelCard>
    );
  }

  /* ── Paso 1 y 2 ──────────────────────────────────────────────────────── */
  const awaitingCode = maskedPhone !== null;

  return (
    <BezelCard coreClassName="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
        >
          <DeviceMobile size={22} />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-foreground">
            {awaitingCode ? COPY.stepCodeTitle : COPY.stepPhoneTitle}
          </h2>
          <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
            {awaitingCode
              ? COPY.stepCodeBody(maskedPhone, ttlMinutes)
              : COPY.stepPhoneBody}
          </p>
        </div>
      </div>

      <FormError>{formError}</FormError>

      <Field
        htmlFor="phone-number"
        label={COPY.phoneLabel}
        help={awaitingCode ? undefined : COPY.phoneHelp}
        error={fieldErrors.phone}
      >
        <Input
          id="phone-number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={COPY.phonePlaceholder}
          value={phone}
          // En el paso 2 el número queda visible pero bloqueado: sirve de
          // recordatorio de a dónde fue el código, sin invitar a cambiarlo por
          // accidente mientras se espera el SMS.
          readOnly={awaitingCode}
          disabled={pending}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={fieldErrors.phone ? true : undefined}
          aria-describedby={
            fieldErrors.phone ? "phone-number-error" : awaitingCode ? undefined : "phone-number-help"
          }
        />
      </Field>

      {!awaitingCode ? (
        <Button type="button" loading={pending} onClick={send} className="self-start">
          <PaperPlaneTilt size={18} aria-hidden="true" />
          {COPY.sendCta}
        </Button>
      ) : (
        <>
          <Field htmlFor="phone-code" label={COPY.codeLabel} error={fieldErrors.code}>
            <Input
              ref={codeRef}
              id="phone-code"
              type="text"
              inputMode="numeric"
              // El código del SMS aparece arriba del teclado y entra de un toque.
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              value={code}
              disabled={pending}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="numeric tracking-[0.4em]"
              aria-invalid={fieldErrors.code ? true : undefined}
              aria-describedby={fieldErrors.code ? "phone-code-error" : undefined}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              loading={pending}
              disabled={code.length !== 6}
              onClick={verify}
            >
              {COPY.verifyCta}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending || cooldown > 0}
              onClick={send}
            >
              {cooldown > 0 ? COPY.resendWait(cooldown) : COPY.resendCta}
            </Button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setMaskedPhone(null);
                setCode("");
                setFormError(null);
                setFieldErrors({});
              }}
              className="min-h-11 rounded-sm px-1 text-sm font-semibold text-brand-ink underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring disabled:opacity-50"
            >
              {COPY.changePhone}
            </button>
          </div>
        </>
      )}
    </BezelCard>
  );
}
