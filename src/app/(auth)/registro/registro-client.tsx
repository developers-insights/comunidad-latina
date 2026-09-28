"use client";

import { useState } from "react";
import { RegisterForm } from "@/components/auth/register-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { CheckEmail } from "@/components/auth/check-email";
import { AuthDivider, AuthHeader } from "@/components/auth/auth-card";
import type { OAuthProvider } from "@/lib/auth/oauth-providers";

const COPY = {
  title: "Sumate a tu comunidad",
  subtitle:
    "En un minuto estás adentro. No te pedimos ni tu teléfono ni tu dirección.",
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
      <AuthHeader title={COPY.title} subtitle={COPY.subtitle} />

      {/* Google y Apple ARRIBA en el alta —al revés que en /entrar— porque acá
          sí son el camino más corto: cero campos, cero contraseña que inventar
          y cero correo que confirmar. Quien prefiere el formulario lo tiene
          entero justo debajo, sin nada plegado. */}
      <OAuthButtons providers={oauthProviders} next="/bienvenida" withDivider={false} />

      {oauthProviders.length > 0 && <AuthDivider label={COPY.emailDivider} />}

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
