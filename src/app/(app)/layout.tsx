import type { ReactNode } from "react";
import { getTenant } from "@/lib/tenant/resolve";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/shell/header";
import { BottomNav } from "@/components/shell/bottom-nav";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { TenantMismatchBanner } from "@/components/shell/tenant-mismatch-banner";
import { AccountGate } from "@/components/shell/account-gate";
import { InstallPrompt } from "@/components/pwa/install-prompt";

/**
 * Shell de la app autenticada: Header + contenido mobile-first centrado + BottomNav.
 * Las CSS variables de marca ya viven en <html> (root layout) y el fondo/texto
 * en <body> — acá solo queda la estructura.
 *
 * Gate de sanciones (0021): una cuenta suspendida vigente o dada de baja ve la
 * pantalla de AccountGate en lugar de la app. Espeja app.account_active() de la
 * DB (que ya bloquea toda escritura por trigger): suspended con vencimiento
 * futuro o sin vencimiento → bloquea; suspensión vencida → pasa (la DB también
 * la trata como activa).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenant();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: sanction } = await supabase
      .from("profiles")
      .select("account_status, suspended_until")
      .eq("id", user.id)
      .maybeSingle();
    if (sanction?.account_status === "banned") {
      return <AccountGate kind="banned" />;
    }
    if (
      sanction?.account_status === "suspended" &&
      (!sanction.suspended_until || new Date(sanction.suspended_until) > new Date())
    ) {
      return <AccountGate kind="suspended" suspendedUntil={sanction.suspended_until} />;
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg focus:ring-[3px] focus:ring-focus-ring"
      >
        Saltar al contenido
      </a>
      <OfflineBanner />
      {/* El sticky vive acá y no en el <header> para no acoplar el componente
          a su posición en el shell (ver comentario en shell/header.tsx). */}
      <div className="sticky top-0 z-40">
        <Header tenant={tenant} />
      </div>
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
