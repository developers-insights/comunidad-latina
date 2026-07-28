"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { registerAction } from "@/app/(auth)/actions";
import { FormError } from "@/components/auth/form-error";
import { Button, Field, Input } from "@/components/ui";

const COPY = {
  displayName: "Tu nombre para mostrar",
  displayNameHelp: "Así te va a ver la comunidad. Puede ser solo tu nombre de pila.",
  displayNamePlaceholder: "Rosa Martínez",
  email: "Tu email",
  emailPlaceholder: "nombre@ejemplo.com",
  password: "Creá una contraseña",
  passwordHelp: "Al menos 8 caracteres.",
  ageLabel: "Confirmo que tengo 18 años o más.",
  ageRequired: "Confirmá que tenés 18 años o más para sumarte.",
  // El texto de aceptación se arma con enlaces (ver más abajo).
  termsPrefix: "Acepto los",
  termsTerms: "Términos de Uso",
  termsPrivacyJoin: ", la",
  termsPrivacy: "Política de Privacidad",
  termsNormsJoin: "y las",
  termsNorms: "Normas de la Comunidad",
  termsRequired: "Aceptá los Términos, la Privacidad y las Normas para sumarte.",
  consentHint: "Confirmá tu edad y aceptá las condiciones para poder sumarte.",
  submit: "Sumate a tu comunidad",
  hasAccount: "¿Ya tenés cuenta?",
  goLogin: "Entrá acá",
} as const;

const legalLinkClass =
  "rounded-sm font-medium text-brand-ink underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring";

export interface RegisterFormProps {
  /** Se llama con la sesión ya creada (cookies listas). */
  onSuccess: () => void;
  /** Oculta el link "¿Ya tenés cuenta?" (ej. dentro del onboarding). */
  hideLoginLink?: boolean;
  /** Se agrega al link de login (ej. "/bienvenida" para retomar el onboarding). */
  loginNext?: string;
}

export function RegisterForm({
  onSuccess,
  hideLoginLink = false,
  loginNext,
}: RegisterFormProps) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const consentComplete = ageConfirmed && termsAccepted;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    // Puerta de consentimiento (defensa en profundidad; el botón ya va
    // deshabilitado hasta tildar ambos). El server igual lo revalida.
    if (!consentComplete) {
      setFieldErrors({
        ...(ageConfirmed ? {} : { ageConfirmed: COPY.ageRequired }),
        ...(termsAccepted ? {} : { termsAccepted: COPY.termsRequired }),
      });
      return;
    }

    const form = new FormData(event.currentTarget);
    const input = {
      displayName: String(form.get("displayName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      ageConfirmed,
      termsAccepted,
    } as const;
    startTransition(async () => {
      const result = await registerAction(input);
      if (result.ok) {
        onSuccess();
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? null);
    });
  }

  const loginHref = loginNext
    ? `/entrar?next=${encodeURIComponent(loginNext)}`
    : "/entrar";

  return (
    // method="post": un envío antes de hidratar no puede dejar la contraseña en
    // la URL ni en el historial (ver el comentario largo en login-form.tsx).
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError>{formError}</FormError>

      <Field
        htmlFor="register-name"
        label={COPY.displayName}
        help={COPY.displayNameHelp}
        error={fieldErrors.displayName}
      >
        <Input
          id="register-name"
          name="displayName"
          type="text"
          autoComplete="name"
          placeholder={COPY.displayNamePlaceholder}
          aria-invalid={fieldErrors.displayName ? true : undefined}
          aria-describedby={fieldErrors.displayName ? "register-name-error" : undefined}
        />
      </Field>

      <Field htmlFor="register-email" label={COPY.email} error={fieldErrors.email}>
        <Input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={COPY.emailPlaceholder}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "register-email-error" : undefined}
        />
      </Field>

      <Field
        htmlFor="register-password"
        label={COPY.password}
        help={COPY.passwordHelp}
        error={fieldErrors.password}
      >
        <Input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={
            fieldErrors.password ? "register-password-error" : undefined
          }
        />
      </Field>

      <div className="mt-1 flex flex-col gap-3">
        <ConsentCheckbox
          id="register-age"
          checked={ageConfirmed}
          onChange={(next) => {
            setAgeConfirmed(next);
            if (next) setFieldErrors((prev) => omit(prev, "ageConfirmed"));
          }}
          error={fieldErrors.ageConfirmed}
        >
          {COPY.ageLabel}
        </ConsentCheckbox>

        <ConsentCheckbox
          id="register-terms"
          checked={termsAccepted}
          onChange={(next) => {
            setTermsAccepted(next);
            if (next) setFieldErrors((prev) => omit(prev, "termsAccepted"));
          }}
          error={fieldErrors.termsAccepted}
        >
          {COPY.termsPrefix}{" "}
          <Link
            href="/legal/terminos"
            target="_blank"
            rel="noopener noreferrer"
            className={legalLinkClass}
          >
            {COPY.termsTerms}
          </Link>
          {COPY.termsPrivacyJoin}{" "}
          <Link
            href="/legal/privacidad"
            target="_blank"
            rel="noopener noreferrer"
            className={legalLinkClass}
          >
            {COPY.termsPrivacy}
          </Link>{" "}
          {COPY.termsNormsJoin}{" "}
          <Link
            href="/legal/normas"
            target="_blank"
            rel="noopener noreferrer"
            className={legalLinkClass}
          >
            {COPY.termsNorms}
          </Link>
          .
        </ConsentCheckbox>
      </div>

      <Button
        type="submit"
        size="lg"
        loading={pending}
        disabled={!consentComplete}
        aria-describedby={!consentComplete ? "register-consent-hint" : undefined}
        className="mt-2 w-full"
      >
        {COPY.submit}
      </Button>
      {!consentComplete && (
        <p
          id="register-consent-hint"
          className="-mt-2 text-center text-sm text-foreground-muted"
        >
          {COPY.consentHint}
        </p>
      )}

      {!hideLoginLink && (
        <p className="text-center text-sm text-foreground-secondary">
          {COPY.hasAccount}{" "}
          <Link
            href={loginHref}
            className="font-semibold text-brand-ink underline-offset-4 hover:underline"
          >
            {COPY.goLogin}
          </Link>
        </p>
      )}
    </form>
  );
}

/** Quita una clave de un mapa de errores sin mutar el original. */
function omit(
  errors: Record<string, string>,
  key: string,
): Record<string, string> {
  if (!(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

/**
 * Checkbox de consentimiento accesible (no hay primitivo Checkbox en el design
 * system). Label envolvente para que el texto agrande el área clickeable; los
 * enlaces internos NO tildan la casilla (por spec, el label ignora la
 * activación sobre contenido interactivo).
 */
function ConsentCheckbox({
  id,
  checked,
  onChange,
  error,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  children: React.ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="flex cursor-pointer items-start gap-3 text-sm text-foreground-secondary"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <span>{children}</span>
      </label>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 pl-8 text-sm text-danger"
        >
          <WarningCircle
            size={16}
            weight="fill"
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          />
          {error}
        </p>
      ) : null}
    </div>
  );
}
