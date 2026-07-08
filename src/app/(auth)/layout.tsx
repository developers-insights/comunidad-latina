import type { ReactNode } from "react";
import Link from "next/link";
import { getTenant } from "@/lib/tenant/resolve";
import { ThemeToggle } from "@/components/theme";

/**
 * Layout de auth: minimal, centrado, con zona de logo del tenant arriba.
 * Las páginas (entrar, registro, bienvenida) las escribe el agente AUTH.
 *
 * El toggle de tema va en la esquina, discreto: un usuario deslogueado también
 * elige su tema. Primero en el DOM porque es lo primero que se lee arriba a la
 * derecha; `top` respeta el notch (el root layout usa viewportFit: cover).
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenant();

  return (
    <div className="relative flex min-h-dvh flex-col items-center px-4">
      <ThemeToggle className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10" />
      <div className="flex w-full max-w-sm flex-1 flex-col justify-center py-12">
        <Link
          href="/"
          className="mb-8 self-center rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          aria-label={tenant.name}
        >
          <span className="text-2xl font-bold tracking-tight text-brand-ink">
            {tenant.name}
          </span>
        </Link>
        {children}
      </div>
    </div>
  );
}
