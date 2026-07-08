import type { CSSProperties, ReactNode } from "react";
import { getTenant } from "@/lib/tenant/resolve";
import { brandThemeToStyle } from "@/lib/tenant/brand-pipeline";
import { Header } from "@/components/shell/header";
import { BottomNav } from "@/components/shell/bottom-nav";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { TenantMismatchBanner } from "@/components/shell/tenant-mismatch-banner";
import { InstallPrompt } from "@/components/pwa/install-prompt";

/**
 * Shell de la app autenticada: Header + contenido mobile-first centrado + BottomNav.
 * Las CSS variables de marca se inyectan acá; cuando DESIGN tome el root layout,
 * pueden subir a <html> sin tocar nada más.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenant();

  return (
    <div
      style={brandThemeToStyle(tenant.brandHex) as CSSProperties}
      className="flex min-h-dvh flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50"
    >
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg focus:ring-[3px] focus:ring-[var(--color-brand-200)]"
      >
        Saltar al contenido
      </a>
      <OfflineBanner />
      <Header tenant={tenant} />
      <TenantMismatchBanner />
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto w-full max-w-lg flex-1 px-4 pb-28 pt-4 focus:outline-none"
      >
        {children}
      </main>
      <BottomNav />
      <InstallPrompt />
    </div>
  );
}
