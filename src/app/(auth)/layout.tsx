import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { getTenant } from "@/lib/tenant/resolve";
import { brandThemeToStyle } from "@/lib/tenant/brand-pipeline";

/**
 * Layout de auth: minimal, centrado, con zona de logo del tenant arriba.
 * Las páginas (entrar, registro, bienvenida) las escribe el agente AUTH.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenant();

  return (
    <div
      style={brandThemeToStyle(tenant.brandHex) as CSSProperties}
      className="flex min-h-dvh flex-col items-center bg-neutral-50 px-4 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50"
    >
      <div className="flex w-full max-w-sm flex-1 flex-col justify-center py-12">
        <Link
          href="/"
          className="mb-8 self-center rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]"
          aria-label={tenant.name}
        >
          <span className="text-2xl font-bold tracking-tight text-[var(--color-brand)]">
            {tenant.name}
          </span>
        </Link>
        {children}
      </div>
    </div>
  );
}
