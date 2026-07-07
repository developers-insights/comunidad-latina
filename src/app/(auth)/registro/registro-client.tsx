"use client";

import { useRouter } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";

const COPY = {
  title: "Sumate a tu comunidad",
  subtitle:
    "En un minuto estás adentro. Para crear tu cuenta no te pedimos ni tu teléfono ni tu dirección.",
} as const;

export function RegistroClient() {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          {COPY.title}
        </h1>
        <p className="text-sm text-foreground-secondary">{COPY.subtitle}</p>
      </header>

      <RegisterForm
        onSuccess={() => {
          // Cuenta creada y logueada → completar el onboarding.
          router.replace("/bienvenida");
          router.refresh();
        }}
      />
    </div>
  );
}
