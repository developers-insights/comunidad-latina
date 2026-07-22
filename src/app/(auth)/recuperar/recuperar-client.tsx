"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { EnvelopeSimple, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { requestPasswordResetAction } from "@/app/(auth)/actions";
import { FormError } from "@/components/auth/form-error";
import { Button, Field, Input } from "@/components/ui";

const COPY = {
  title: "Recuperá tu contraseña",
  subtitle: "Escribí tu email y te mandamos un enlace para crear una nueva.",
  email: "Tu email",
  emailPlaceholder: "nombre@ejemplo.com",
  submit: "Mandame el enlace",
  emailRequired: "Escribí tu email para poder mandarte el enlace.",
  sent: "Si ese email está registrado, te mandamos un enlace para restablecer tu contraseña. Revisá tu correo (y la carpeta de spam).",
  backToLogin: "Volver a entrar",
  remembered: "¿Te acordaste la contraseña?",
} as const;

export function RecuperarClient() {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setEmailError(undefined);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    if (!email) {
      setEmailError(COPY.emailRequired);
      return;
    }

    startTransition(async () => {
      const result = await requestPasswordResetAction({ email });
      if (result.ok) {
        // Aviso genérico SIEMPRE: no revelamos si el email existe o no.
        setSent(true);
        return;
      }
      setEmailError(result.fieldErrors?.email);
      setFormError(result.formError ?? null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          {COPY.title}
        </h1>
        <p className="text-sm text-foreground-secondary">{COPY.subtitle}</p>
      </header>

      {sent ? (
        <div
          role="status"
          className="flex flex-col items-center gap-3 rounded-lg bg-success-bg px-6 py-8 text-center"
        >
          <PaperPlaneTilt size={32} aria-hidden="true" className="text-success" />
          <p className="text-sm text-foreground">{COPY.sent}</p>
          <Link
            href="/entrar"
            className="mt-1 text-sm font-semibold text-brand-ink underline-offset-4 hover:underline"
          >
            {COPY.backToLogin}
          </Link>
        </div>
      ) : (
        <>
          <FormError>{formError}</FormError>

          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <Field htmlFor="recuperar-email" label={COPY.email} error={emailError}>
              <Input
                id="recuperar-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder={COPY.emailPlaceholder}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "recuperar-email-error" : undefined}
              />
            </Field>
            <Button type="submit" size="lg" loading={pending} className="mt-2 w-full">
              <EnvelopeSimple size={18} aria-hidden="true" />
              {COPY.submit}
            </Button>
          </form>

          <p className="text-center text-sm text-foreground-secondary">
            {COPY.remembered}{" "}
            <Link
              href="/entrar"
              className="font-semibold text-brand-ink underline-offset-4 hover:underline"
            >
              {COPY.backToLogin}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
