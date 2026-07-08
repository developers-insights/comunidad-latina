import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { getTenant } from "@/lib/tenant/resolve";
import { Badge } from "@/components/ui";
import { AdminNav } from "@/components/admin/admin-nav";
import { ThemeToggle } from "@/components/theme";
import { requireStaff } from "./guard";

/**
 * Shell del panel de administración (§12) — 3 paneles por rol, misma app.
 *
 * Gate server-side ANTES de renderizar nada: supabase.auth.getUser() +
 * app_metadata.role (JWT, la misma fuente que usan las policies de RLS).
 * Miembro común o anónimo → redirect fuera del panel.
 *
 * Diseño §1.1.④: única superficie "power user" del producto — más densa y
 * ancha que el shell de la app (max-w-3xl vs max-w-lg), pero con los mismos
 * tokens. Sobria: nada de dopamina, es una mesa de trabajo.
 */

const COPY = {
  title: "Panel de administración",
  backToApp: "Volver a la app",
  roleLabel: {
    moderator: "Moderación",
    domain_admin: "Admin del dominio",
    global_admin: "Súper admin",
  },
} as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { supabase, role } = await requireStaff();
  const tenant = await getTenant();

  // Contador de pendientes del nav: la RLS ya acota la cola al tenant del
  // staff (global_admin ve todas) — count liviano, sin filas.
  const { count } = await supabase
    .from("moderation_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="truncate text-base font-bold tracking-tight text-brand-ink">
              {tenant.name}
            </span>
            <span className="hidden text-sm text-foreground-muted sm:inline" aria-hidden="true">
              ·
            </span>
            <h1 className="hidden truncate text-sm font-medium text-foreground-secondary sm:block">
              {COPY.title}
            </h1>
            <Badge variant="brand">{COPY.roleLabel[role]}</Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/feed"
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-foreground-secondary transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              {COPY.backToApp}
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <AdminNav role={role} pendingCount={count ?? 0} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
