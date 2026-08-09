"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { registerAction, type RegisterInput } from "@/app/(auth)/actions";
import { FormError } from "@/components/auth/form-error";
import { suggestUsername } from "@/lib/profile/username";
import { UsernameInput } from "@/components/auth/username-input";
import { Button, Field, Input } from "@/components/ui";

const COPY = {
  displayName: "Nombre",
  displayNamePlaceholder: "Rosa",
  lastName: "Apellido",
  lastNamePlaceholder: "Martínez",
  nameHelp: "Tu apellido no se muestra: lo decidís vos después, en tu perfil.",
  username: "Tu nombre de usuario",
  usernameHelp: "Así te encuentran y te mencionan. Se puede cambiar después.",
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
  /**
   * Cuenta creada — OJO: todavía NO hay sesión. La sesión la crea /confirmar
   * cuando la persona toca el enlace del correo, así que lo que corresponde acá
   * es mostrar "revisá tu correo", nunca navegar a una pantalla con sesión.
   *
   * Recibe el email tal como lo escribió la persona, para poder repetírselo.
   */
  onSuccess: (email: string) => void;
  /** Oculta el link "¿Ya tenés cuenta?" (ej. dentro del onboarding). */
  hideLoginLink?: boolean;
  /** Se agrega al link de login (ej. "/bienvenida" para retomar el onboarding). */
  loginNext?: string;
  /**
   * Respuestas del onboarding ya recolectadas (el wizard pregunta antes de
   * crear la cuenta). Se guardan junto con el perfil en el mismo registro.
   */
  needs?: readonly string[];
  area?: string;
  /** Ruta interna a la que aterriza al confirmar el correo. */
  next?: string;
}

export function RegisterForm({
  onSuccess,
  hideLoginLink = false,
  loginNext,
  needs,
  area,
  next,
}: RegisterFormProps) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  /**
   * El handle se propone a partir del nombre y el apellido MIENTRAS la persona
   * no lo haya tocado. Sugerir en vez de generar: el campo llega escrito —que es
   * lo que hace que no quede vacío— pero se ve, se puede borrar y es la persona
   * la que lo acepta. En cuanto escribe algo propio, la sugerencia deja de
   * pisarle el texto para siempre (`usernameTouched`).
   */
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);

  const consentComplete = ageConfirmed && termsAccepted;

  function retitleUsername(nextFirst: string, nextLast: string) {
    if (usernameTouched) return;
    setUsername(suggestUsername(`${nextFirst} ${nextLast}`.trim()));
  }

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
      displayName: firstName,
      lastName,
      username,
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      ageConfirmed,
      termsAccepted,
      ...(needs && needs.length > 0 ? { needs: [...needs] } : {}),
      ...(area?.trim() ? { area: area.trim() } : {}),
      ...(next ? { next } : {}),
    } as RegisterInput;
    startTransition(async () => {
      const result = await registerAction(input);
      if (result.ok) {
        onSuccess(input.email.trim());
        return;
      }
      const errors = result.fieldErrors ?? {};
      setFieldErrors(errors);
      setFormError(result.formError ?? null);
      focusFirstInvalid(errors);
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

      {/* Nombre y apellido en la misma fila: son un solo gesto mental y en
          columnas separadas se leen como un solo paso, no como dos campos más.
          Dos columnas ya desde 375px — con etiquetas de una palabra, entran. */}
      <div className="grid grid-cols-2 gap-3">
        <Field
          htmlFor="register-name"
          label={COPY.displayName}
          error={fieldErrors.displayName}
        >
          <Input
            id="register-name"
            name="displayName"
            type="text"
            autoComplete="given-name"
            placeholder={COPY.displayNamePlaceholder}
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              retitleUsername(e.target.value, lastName);
            }}
            aria-invalid={fieldErrors.displayName ? true : undefined}
            aria-describedby={fieldErrors.displayName ? "register-name-error" : undefined}
          />
        </Field>

        <Field
          htmlFor="register-lastname"
          label={COPY.lastName}
          error={fieldErrors.lastName}
        >
          <Input
            id="register-lastname"
            name="lastName"
            type="text"
            autoComplete="family-name"
            placeholder={COPY.lastNamePlaceholder}
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              retitleUsername(firstName, e.target.value);
            }}
            aria-invalid={fieldErrors.lastName ? true : undefined}
            aria-describedby={fieldErrors.lastName ? "register-lastname-error" : undefined}
          />
        </Field>
      </div>

      {/* La promesa sobre el apellido va acá, bajo los dos campos, y no dentro
          de uno: es lo primero que alguien se pregunta al ver que le piden el
          apellido, y responderlo en el momento evita el abandono. */}
      {!fieldErrors.displayName && !fieldErrors.lastName && (
        <p className="-mt-2 text-sm text-foreground-muted">{COPY.nameHelp}</p>
      )}

      <Field
        htmlFor="register-username"
        label={COPY.username}
        help={COPY.usernameHelp}
        error={fieldErrors.username}
      >
        <UsernameInput
          id="register-username"
          name="username"
          value={username}
          onChange={(next) => {
            setUsernameTouched(true);
            setUsername(next);
            if (fieldErrors.username) setFieldErrors((prev) => omit(prev, "username"));
          }}
          invalid={Boolean(fieldErrors.username)}
          describedBy={
            fieldErrors.username ? "register-username-error" : "register-username-help"
          }
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

/** El id del control de cada campo, para poder enfocarlo cuando falla. */
const FIELD_CONTROL_ID: Record<string, string> = {
  displayName: "register-name",
  lastName: "register-lastname",
  username: "register-username",
  email: "register-email",
  password: "register-password",
};

/**
 * Enfoca el primer campo con error, en el ORDEN DEL FORMULARIO.
 *
 * El caso que esto arregla es concreto: el handle ya tomado sólo se descubre en
 * el servidor, y el error aparece a media pantalla de scroll. Sin esto, quien
 * usa lector de pantalla no se entera de que hubo un error —el foco sigue en el
 * botón— y quien mira tiene que buscar dónde está el subrayado rojo.
 */
function focusFirstInvalid(errors: Record<string, string>): void {
  for (const field of Object.keys(FIELD_CONTROL_ID)) {
    if (!errors[field]) continue;
    const control = document.getElementById(FIELD_CONTROL_ID[field]);
    control?.focus();
    control?.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
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
