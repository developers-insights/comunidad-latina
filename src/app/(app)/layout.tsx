import type { CSSProperties, ReactNode } from "react";
import { getTenant } from "@/lib/tenant/resolve";
import { brandThemeToStyle } from "@/lib/tenant/brand-pipeline";
import { Header } from "@/components/shell/header";
import { BottomNav } from "@/components/shell/bottom-nav";
import { OfflineBanner } from "@/components/shell/offline-banner";

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
      <OfflineBanner />
      <Header tenant={tenant} />
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-28 pt-4">{children}</main>
      <BottomNav />
    </div>
  );
}
