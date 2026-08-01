"use client";

import { useState } from "react";
import { RegisterForm } from "@/components/auth/register-form";
import { CheckEmail } from "@/components/auth/check-email";

const COPY = {
  title: "Sumate a tu comunidad",
  subtitle:
    "En un minuto estás adentro. Para crear tu cuenta no te pedimos ni tu teléfono ni tu dirección.",
} as const;

export function RegistroClient() {
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
