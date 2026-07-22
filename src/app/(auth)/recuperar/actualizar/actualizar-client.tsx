"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeSlash } from "@phosphor-icons/react/dist/ssr";
import { updatePasswordAction } from "@/app/(auth)/actions";
import { FormError } from "@/components/auth/form-error";
import { Button, Field, Input } from "@/components/ui";

const COPY = {
  title: "Creá tu contraseña nueva",
  subtitle: "Elegí una contraseña y ya entrás a tu cuenta.",
  password: "Contraseña nueva",
  passwordHelp: "Al menos 8 caracteres.",
  confirm: "Repetí la contraseña",
  showPassword: "Mostrar contraseña",
  hidePassword: "Ocultar contraseña",
  passwordRequired: "Escribí una contraseña nueva.",
  mismatch: "Las contraseñas no coinciden. Revisalas y probá de nuevo.",
  submit: "Guardar y entrar",
} as const;

export function ActualizarClient() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    if (!password) {
      setFieldErrors({ password: COPY.passwordRequired });
      return;
    }
    if (password !== confirm) {
      setFieldErrors({ confirm: COPY.mismatch });
      return;
    }

    startTransition(async () => {
      const result = await updatePasswordAction({ password });
      if (result.ok) {
        router.replace("/feed");
        router.refresh();
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
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

      <FormError>{formError}</FormError>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field
          htmlFor="nueva-password"
          label={COPY.password}
          help={COPY.passwordHelp}
          error={fieldErrors.password}
        >
          <div className="relative">
            <Input
              id="nueva-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              className="pr-11"
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={
                fieldErrors.password ? "nueva-password-error" : undefined
              }
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? COPY.hidePassword : COPY.showPassword}
              aria-pressed={showPassword}
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
            >
              {showPassword ? (
                <EyeSlash size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
            </button>
          </div>
        </Field>

        <Field
          htmlFor="confirmar-password"
          label={COPY.confirm}
          error={fieldErrors.confirm}
        >
          <Input
            id="confirmar-password"
            name="confirm"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            aria-invalid={fieldErrors.confirm ? true : undefined}
            aria-describedby={
              fieldErrors.confirm ? "confirmar-password-error" : undefined
            }
          />
        </Field>

        <Button type="submit" size="lg" loading={pending} className="mt-2 w-full">
          {COPY.submit}
        </Button>
      </form>
    </div>
  );
}
