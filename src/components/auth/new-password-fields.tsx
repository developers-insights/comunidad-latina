"use client";

import { useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { Field } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  PASSWORD_COPY,
  PASSWORD_RULES,
  passwordProblem,
  passwordRuleResults,
} from "@/lib/auth/password-policy";
import { PasswordInput } from "./password-input";

export const NEW_PASSWORD_COPY = {
  password: "Creá una contraseña",
  confirm: "Repetí la contraseña",
  rulesLabel: "Tu contraseña necesita",
  ruleMet: "listo",
  rulePending: "falta",
  match: "Coinciden",
  noMatchYet: "Todavía no coinciden",
} as const;

export type NewPasswordErrors = { password?: string; passwordConfirm?: string };

export function validateNewPassword(password: string, confirm: string): NewPasswordErrors {
  const errors: NewPasswordErrors = {};
  const problem = passwordProblem(password);
  if (problem) errors.password = problem;
  if (!confirm) errors.passwordConfirm = PASSWORD_COPY.confirmRequired;
  else if (confirm !== password) errors.passwordConfirm = PASSWORD_COPY.mismatch;
  return errors;
}

// Keychain de iOS y el gestor de Chrome leen este atributo para sugerir una
// contraseña que ya cumpla la política; sin él proponen una sin mayúscula o sin
// número y la persona choca contra el checklist. Tiene que espejar PASSWORD_RULES.
const PASSWORD_RULES_HINT = {
  passwordrules: "minlength: 8; maxlength: 72; required: upper; required: digit;",
};

export interface NewPasswordFieldsProps {
  /** Prefijo de ids: queda `${idPrefix}-password` y `${idPrefix}-password-confirm`. */
  idPrefix: string;
  password: string;
  confirm: string;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  /** Error que viene del submit o del servidor. Gana sobre el del blur. */
  passwordError?: string;
  confirmError?: string;
  passwordLabel?: string;
  confirmLabel?: string;
}

export function NewPasswordFields({
  idPrefix,
  password,
  confirm,
  onPasswordChange,
  onConfirmChange,
  passwordError,
  confirmError,
  passwordLabel = NEW_PASSWORD_COPY.password,
  confirmLabel = NEW_PASSWORD_COPY.confirm,
}: NewPasswordFieldsProps) {
  const passwordId = `${idPrefix}-password`;
  const confirmId = `${idPrefix}-password-confirm`;
  const rulesId = `${passwordId}-rules`;
  const statusId = `${confirmId}-status`;

  // El error del blur se borra al volver a escribir: mientras la persona teclea
  // el feedback es el checklist, nunca un rojo que la corrige a mitad de palabra.
  const [passwordBlurError, setPasswordBlurError] = useState<string | null>(null);
  const [confirmBlurError, setConfirmBlurError] = useState<string | null>(null);

  const shownPasswordError = passwordError ?? passwordBlurError ?? undefined;
  const shownConfirmError = confirmError ?? confirmBlurError ?? undefined;
  const results = passwordRuleResults(password);
  const matchState = confirm === "" ? "empty" : confirm === password ? "match" : "pending";

  return (
    <div className="flex flex-col gap-4">
      <Field htmlFor={passwordId} label={passwordLabel} error={shownPasswordError}>
        <PasswordInput
          id={passwordId}
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPasswordBlurError(null);
            onPasswordChange(event.target.value);
          }}
          onBlur={() => {
            if (password) setPasswordBlurError(passwordProblem(password));
          }}
          aria-invalid={shownPasswordError ? true : undefined}
          aria-describedby={shownPasswordError ? `${rulesId} ${passwordId}-error` : rulesId}
          {...PASSWORD_RULES_HINT}
        />
        <ul id={rulesId} aria-label={NEW_PASSWORD_COPY.rulesLabel} className="mt-1 flex flex-col gap-1.5">
          {PASSWORD_RULES.map((rule) => (
            <RuleItem
              key={rule.id}
              label={rule.label}
              met={results[rule.id]}
              failing={Boolean(shownPasswordError) && !results[rule.id]}
            />
          ))}
        </ul>
      </Field>

      <Field htmlFor={confirmId} label={confirmLabel} error={shownConfirmError}>
        <PasswordInput
          id={confirmId}
          name="passwordConfirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => {
            setConfirmBlurError(null);
            onConfirmChange(event.target.value);
          }}
          onBlur={() => {
            if (confirm && confirm !== password) setConfirmBlurError(PASSWORD_COPY.mismatch);
          }}
          aria-invalid={shownConfirmError ? true : undefined}
          aria-describedby={shownConfirmError ? `${confirmId}-error` : statusId}
          showLabel="Mostrar la contraseña repetida"
          hideLabel="Ocultar la contraseña repetida"
        />
        <div id={statusId} aria-live="polite">
          {!shownConfirmError && matchState === "match" && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-success-ink">
              <CheckCircle size={16} weight="fill" aria-hidden="true" className="shrink-0" />
              {NEW_PASSWORD_COPY.match}
            </p>
          )}
          {!shownConfirmError && matchState === "pending" && (
            <p className="text-sm text-foreground-muted">{NEW_PASSWORD_COPY.noMatchYet}</p>
          )}
        </div>
      </Field>
    </div>
  );
}

function RuleItem({ label, met, failing }: { label: string; met: boolean; failing: boolean }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-[1.125rem] shrink-0 place-items-center rounded-full border-[1.5px]",
          "transition-[background-color,border-color,transform] duration-(--duration-base) ease-(--ease-spring) motion-reduce:transition-none",
          met
            ? "scale-100 border-success bg-success text-on-success"
            : failing
              ? "scale-100 border-danger bg-transparent"
              : "scale-90 border-border-strong bg-transparent",
        )}
      >
        <svg viewBox="0 0 12 12" className="size-3" fill="none">
          <path
            d="M2.6 6.3 4.9 8.5 9.4 3.6"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            style={{ strokeDashoffset: met ? 0 : 1 }}
            className="transition-[stroke-dashoffset] delay-75 duration-(--duration-base) ease-(--ease-out-premium) motion-reduce:transition-none"
          />
        </svg>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "transition-colors duration-(--duration-fast)",
          met ? "text-foreground" : failing ? "text-danger" : "text-foreground-muted",
        )}
      >
        {label}
      </span>
      <span className="sr-only" aria-live="polite">
        {`${label}: ${met ? NEW_PASSWORD_COPY.ruleMet : NEW_PASSWORD_COPY.rulePending}`}
      </span>
    </li>
  );
}
