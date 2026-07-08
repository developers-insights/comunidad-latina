"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
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
  submit: "Sumate a tu comunidad",
  hasAccount: "¿Ya tenés cuenta?",
  goLogin: "Entrá acá",
} as const;

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

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const form = new FormData(event.currentTarget);
    const input = {
      displayName: String(form.get("displayName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };
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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
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

      <Button type="submit" size="lg" loading={pending} className="mt-2 w-full">
        {COPY.submit}
      </Button>

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
