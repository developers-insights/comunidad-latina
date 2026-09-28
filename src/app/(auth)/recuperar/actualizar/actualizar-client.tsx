"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePasswordAction } from "@/app/(auth)/actions";
import { FormError } from "@/components/auth/form-error";
import { AuthHeader, authSubmitClass } from "@/components/auth/auth-card";
import {
  NewPasswordFields,
  validateNewPassword,
  type NewPasswordErrors,
} from "@/components/auth/new-password-fields";
import { Button } from "@/components/ui";

const COPY = {
  title: "Creá tu contraseña nueva",
  subtitle: "Elegí una contraseña y ya entrás a tu cuenta.",
  password: "Contraseña nueva",
  confirm: "Repetí la contraseña nueva",
  submit: "Guardar y entrar",
} as const;

const FIELD_CONTROL_ID: Record<keyof NewPasswordErrors, string> = {
  password: "nueva-password",
  passwordConfirm: "nueva-password-confirm",
};

export function ActualizarClient() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<NewPasswordErrors>({});
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  function showErrors(errors: NewPasswordErrors) {
    setFieldErrors(errors);
    const first = (Object.keys(FIELD_CONTROL_ID) as (keyof NewPasswordErrors)[]).find(
      (key) => errors[key],
    );
    if (first) document.getElementById(FIELD_CONTROL_ID[first])?.focus();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);

    const errors = validateNewPassword(password, passwordConfirm);
    if (errors.password || errors.passwordConfirm) {
      showErrors(errors);
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      const result = await updatePasswordAction({ password, passwordConfirm });
      if (result.ok) {
        router.replace("/feed");
        router.refresh();
        return;
      }
      showErrors({
        password: result.fieldErrors?.password,
        passwordConfirm: result.fieldErrors?.passwordConfirm,
      });
      setFormError(result.formError ?? null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <AuthHeader title={COPY.title} subtitle={COPY.subtitle} />

      <FormError>{formError}</FormError>

      {/* method="post": un envío antes de hidratar no puede dejar la contraseña
          en la URL ni en el historial (ver login-form.tsx). */}
      <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <NewPasswordFields
          idPrefix="nueva"
          password={password}
          confirm={passwordConfirm}
          onPasswordChange={(value) => {
            setPassword(value);
            if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
          }}
          onConfirmChange={(value) => {
            setPasswordConfirm(value);
            if (fieldErrors.passwordConfirm) {
              setFieldErrors((prev) => ({ ...prev, passwordConfirm: undefined }));
            }
          }}
          passwordError={fieldErrors.password}
          confirmError={fieldErrors.passwordConfirm}
          passwordLabel={COPY.password}
          confirmLabel={COPY.confirm}
        />

        <Button
          type="submit"
          size="lg"
          loading={pending}
          className={authSubmitClass}
        >
          {COPY.submit}
        </Button>
      </form>
    </div>
  );
}
