"use client";

import { useState } from "react";
import { RegisterForm } from "@/components/auth/register-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { CheckEmail } from "@/components/auth/check-email";
import type { OAuthProvider } from "@/lib/auth/oauth-providers";

const COPY = {
  title: "Sumate a tu comunidad",
  subtitle:
    "En un minuto estás adentro. Para crear tu cuenta no te pedimos ni tu teléfono ni tu dirección.",
  emailDivider: "o con tu email",
} as const;

export function RegistroClient({
  oauthProviders = [],
}: {
  /** Proveedores con credenciales. Vacío = la pantalla queda como estaba. */
  oauthProviders?: readonly OAuthProvider[];
}) {
  // Con la cuenta creada NO hay sesión todavía: la crea /confirmar cuando la
  // persona toca el enlace del correo. Por eso acá no se navega a ningún lado.
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  if (registeredEmail !== null) {
    return <CheckEmail email={registeredEmail} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          {COPY.title}
        </h1>
        <p className="text-sm text-foreground-secondary">{COPY.subtitle}</p>
      </header>

      {/* Google y Apple ARRIBA en el alta —al revés que en /entrar— porque acá
          sí son el camino más corto: cero campos, cero contraseña que inventar
          y cero correo que confirmar. Quien prefiere el formulario lo tiene
          entero justo debajo, sin nada plegado. */}
      <OAuthButtons providers={oauthProviders} next="/bienvenida" withDivider={false} />

      {oauthProviders.length > 0 && (
        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-border-subtle" />
          <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
            {COPY.emailDivider}
          </span>
          <span className="h-px flex-1 bg-border-subtle" />
        </div>
      )}

      <RegisterForm
        // Al confirmar aterriza en /bienvenida a completar el onboarding: este
        // registro suelto no pasó por el wizard, así que no trae zona ni
        // necesidades.
        next="/bienvenida"
        onSuccess={setRegisteredEmail}
      />
    </div>
  );
}
