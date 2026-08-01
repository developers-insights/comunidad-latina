"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EnvelopeSimple, Eye, EyeSlash, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/client";
import { resendConfirmationAction } from "@/app/(auth)/actions";
import { safeNextPath } from "@/components/auth/next-param";
import { FormError } from "@/components/auth/form-error";
import {
  Button,
  Field,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";

const COPY = {
  title: "Entrá a tu comunidad",
  subtitle: "Qué bueno verte de nuevo.",
  tabPassword: "Con contraseña",
  tabMagic: "Sin contraseña",
  email: "Tu email",
  emailPlaceholder: "nombre@ejemplo.com",
  password: "Tu contraseña",
  showPassword: "Mostrar contraseña",
  hidePassword: "Ocultar contraseña",
  submitPassword: "Entrar",
  forgotPassword: "¿Te olvidaste la contraseña?",
  submitMagic: "Mandame el enlace",
  magicHelp:
    "Te mandamos un enlace a tu correo — lo tocás y entrás, sin contraseña.",
  magicSent:
    "Listo — revisá tu correo y tocá el enlace para entrar. Puede tardar un minuto.",
  emailRequired: "Escribí tu email para poder entrar.",
  passwordRequired: "Escribí tu contraseña.",
  badCredentials:
    "El email o la contraseña no coinciden. Revisalos y probá de nuevo.",
  tooManyRequests:
    "Hiciste varios intentos seguidos — esperá un minuto y probá de nuevo.",
  genericError:
    "No pudimos conectar — revisá tu conexión e intentá de nuevo.",
  linkExpired:
    "Ese enlace ya venció o ya fue usado. Pedí uno nuevo acá abajo.",
  confirmExpired:
    "Ese enlace de confirmación venció o ya se usó. Entrá con tu email y contraseña y te mandamos uno nuevo.",
  notConfirmed:
    "Te falta confirmar tu cuenta. Te acabamos de mandar el enlace de nuevo — revisá tu correo (y el no deseado).",
  noAccount: "¿Primera vez por acá?",
  goRegister: "Sumate a tu comunidad",
} as const;

export function LoginForm({
  next,
  urlError,
}: {
  next?: string;
  /** Código de error que llega por query (?error=enlace del callback). */
  urlError?: string;
}) {
  const router = useRouter();
  const destination = safeNextPath(next);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [error, setError] = useState<string | null>(
    urlError === "enlace"
      ? COPY.linkExpired
      : urlError === "confirmacion"
        ? COPY.confirmExpired
        : null,
  );
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function validateEmail(): boolean {
    if (!email.trim()) {
      setEmailError(COPY.emailRequired);
      return false;
    }
    setEmailError(null);
    return true;
  }

  async function onPasswordSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const emailOk = validateEmail();
    if (!password) setPasswordError(COPY.passwordRequired);
    else setPasswordError(null);
    if (!emailOk || !password) return;

    setPending(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signInError) {
      // Cuenta creada pero nunca confirmada: en vez de dejarla encerrada, le
      // reenviamos el enlace ahí mismo. La action lo mintea solo si estas
      // credenciales son correctas (ver lib/auth/confirmation.ts).
      if (signInError.code === "email_not_confirmed") {
        await resendConfirmationAction({
          email: email.trim().toLowerCase(),
          password,
          next: destination,
        });
        setPending(false);
        setError(COPY.notConfirmed);
        return;
      }
      setPending(false);
      if (signInError.code === "invalid_credentials") setError(COPY.badCredentials);
      else if (signInError.status === 429) setError(COPY.tooManyRequests);
      else setError(COPY.genericError);
      return;
    }
    router.replace(destination);
    router.refresh();
  }

  async function onMagicSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!validateEmail()) return;

    setPending(true);
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/callback?next=${encodeURIComponent(destination)}`,
      },
    });
    setPending(false);
    if (otpError) {
      if (otpError.status === 429) setError(COPY.tooManyRequests);
      else setError(COPY.genericError);
      return;
    }
    setMagicSent(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          {COPY.title}
        </h1>
        <p className="text-sm text-foreground-secondary">{COPY.subtitle}</p>
      </header>

      <FormError>{error}</FormError>

      <Tabs defaultValue="password">
        <TabsList aria-label="Formas de entrar">
          <TabsTrigger value="password">{COPY.tabPassword}</TabsTrigger>
          <TabsTrigger value="magic">{COPY.tabMagic}</TabsTrigger>
        </TabsList>

        <TabsContent value="password">
          {/*
            `method="post"` aunque el envío real lo maneje `onSubmit`: si alguien
            aprieta Entrar ANTES de que hidrate —un teléfono lento, que es medio
            público de esta app— el navegador hace el envío nativo. Sin `method`
            el default es GET y la contraseña termina en la barra de direcciones
            y en el historial. Con POST el envío prematuro falla, que es el
            resultado correcto: nunca filtra la credencial.
          */}
          <form method="post" onSubmit={onPasswordSubmit} noValidate className="flex flex-col gap-4">
            <Field htmlFor="login-email" label={COPY.email} error={emailError ?? undefined}>
              <Input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder={COPY.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "login-email-error" : undefined}
              />
            </Field>
            <Field
              htmlFor="login-password"
              label={COPY.password}
              error={passwordError ?? undefined}
            >
              <div className="relative">
                <Input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-11"
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={passwordError ? "login-password-error" : undefined}
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
            <div className="-mt-1 flex justify-end">
              <Link
                href="/recuperar"
                className="rounded-sm text-sm font-medium text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
              >
                {COPY.forgotPassword}
              </Link>
            </div>
            <Button type="submit" size="lg" loading={pending} className="mt-2 w-full">
              {COPY.submitPassword}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="magic">
          {magicSent ? (
            <div
              role="status"
              className="flex flex-col items-center gap-3 rounded-lg bg-success-bg px-6 py-8 text-center"
            >
              <PaperPlaneTilt size={32} aria-hidden="true" className="text-success" />
              <p className="text-sm text-foreground">{COPY.magicSent}</p>
            </div>
          ) : (
            <form method="post" onSubmit={onMagicSubmit} noValidate className="flex flex-col gap-4">
              <Field
                htmlFor="magic-email"
                label={COPY.email}
                help={COPY.magicHelp}
                error={emailError ?? undefined}
              >
                <Input
                  id="magic-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder={COPY.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={emailError ? true : undefined}
                  aria-describedby={emailError ? "magic-email-error" : undefined}
                />
              </Field>
              <Button type="submit" size="lg" loading={pending} className="mt-2 w-full">
                <EnvelopeSimple size={18} aria-hidden="true" />
                {COPY.submitMagic}
              </Button>
            </form>
          )}
        </TabsContent>
      </Tabs>

      <p className="text-center text-sm text-foreground-secondary">
        {COPY.noAccount}{" "}
        <Link
          href="/registro"
          className="font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          {COPY.goRegister}
        </Link>
      </p>
    </div>
  );
}
